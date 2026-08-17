use std::borrow::Cow;
use std::fmt;
use std::io::{BufReader, Cursor};
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use bytes::Bytes;
use image::codecs::gif::GifDecoder;
use image::codecs::jpeg::JpegDecoder;
use image::codecs::png::PngDecoder;
use image::codecs::webp::WebPDecoder;
use image::{AnimationDecoder, ImageDecoder, Limits};
use parking_lot::Mutex;
use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

pub(crate) const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;
pub(crate) const MAX_IMAGE_DIMENSION: u32 = 16_384;
pub(crate) const MAX_IMAGE_PIXELS: u64 = 40_000_000;
pub(crate) const MAX_IMAGES_PER_RESULT: usize = 20;
pub(crate) const MAX_RESULT_IMAGE_BYTES: usize = 50 * 1024 * 1024;
pub(crate) const MAX_TRANSCRIPT_IMAGES: usize = 20;
pub(crate) const MAX_TRANSCRIPT_IMAGE_BYTES: usize = 50 * 1024 * 1024;
const MAX_DECODE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_BASE64_BYTES: usize = MAX_IMAGE_BYTES.div_ceil(3) * 4;
const MAX_RESIDENT_IMAGE_BYTES: usize = 256 * 1024 * 1024;
static RESIDENT_IMAGE_BYTES: AtomicUsize = AtomicUsize::new(0);
static IMAGE_DECODE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageMimeType {
    Png,
    Jpeg,
    WebP,
    Gif,
}

impl ImageMimeType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Png => "image/png",
            Self::Jpeg => "image/jpeg",
            Self::WebP => "image/webp",
            Self::Gif => "image/gif",
        }
    }

    fn from_str(value: &str) -> Option<Self> {
        match value.to_ascii_lowercase().as_str() {
            "image/png" => Some(Self::Png),
            "image/jpeg" | "image/jpg" => Some(Self::Jpeg),
            "image/webp" => Some(Self::WebP),
            "image/gif" => Some(Self::Gif),
            _ => None,
        }
    }

    fn from_extension(extension: &str) -> Option<Self> {
        match extension.to_ascii_lowercase().as_str() {
            "png" => Some(Self::Png),
            "jpg" | "jpeg" | "jpe" | "jfif" => Some(Self::Jpeg),
            "webp" => Some(Self::WebP),
            "gif" => Some(Self::Gif),
            _ => None,
        }
    }
}

impl Serialize for ImageMimeType {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for ImageMimeType {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::from_str(&value).ok_or_else(|| D::Error::custom("unsupported image MIME type"))
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct ImageMemoryReservation {
    bytes: usize,
}

impl ImageMemoryReservation {
    fn resize(&mut self, bytes: usize) -> Result<(), ToolContentError> {
        if bytes > self.bytes {
            reserve_resident_bytes(bytes - self.bytes)?;
        } else {
            RESIDENT_IMAGE_BYTES.fetch_sub(self.bytes - bytes, Ordering::AcqRel);
        }
        self.bytes = bytes;
        Ok(())
    }
}

impl Drop for ImageMemoryReservation {
    fn drop(&mut self) {
        RESIDENT_IMAGE_BYTES.fetch_sub(self.bytes, Ordering::AcqRel);
    }
}

pub(crate) fn reserve_image_memory(
    bytes: usize,
) -> Result<ImageMemoryReservation, ToolContentError> {
    reserve_resident_bytes(bytes)?;
    Ok(ImageMemoryReservation { bytes })
}

fn reserve_resident_bytes(bytes: usize) -> Result<(), ToolContentError> {
    RESIDENT_IMAGE_BYTES
        .fetch_update(Ordering::AcqRel, Ordering::Acquire, |current| {
            current
                .checked_add(bytes)
                .filter(|next| *next <= MAX_RESIDENT_IMAGE_BYTES)
        })
        .map(|_| ())
        .map_err(|_| {
            ToolContentError::limit(format!(
                "resident image data exceeds the {MAX_RESIDENT_IMAGE_BYTES} byte process limit"
            ))
        })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolImage {
    mime_type: ImageMimeType,
    data: Bytes,
    _reservation: Arc<ImageMemoryReservation>,
}

impl ToolImage {
    #[cfg(test)]
    pub(crate) fn validate(
        data: Vec<u8>,
        path: Option<&Path>,
        declared_mime: Option<&str>,
    ) -> Result<Self, ToolContentError> {
        let reservation = reserve_image_memory(data.len())?;
        Self::validate_reserved(data, path, declared_mime, reservation)
    }

    pub(crate) fn validate_reserved(
        data: Vec<u8>,
        path: Option<&Path>,
        declared_mime: Option<&str>,
        mut reservation: ImageMemoryReservation,
    ) -> Result<Self, ToolContentError> {
        if data.is_empty() {
            return Err(ToolContentError::invalid("image data is empty"));
        }
        if data.len() > MAX_IMAGE_BYTES {
            return Err(ToolContentError::limit(format!(
                "image exceeds the {MAX_IMAGE_BYTES} byte limit"
            )));
        }
        reservation.resize(data.len())?;
        let detected = detect_supported_image(&data).ok_or_else(|| {
            ToolContentError::invalid("image data is malformed or uses an unsupported format")
        })?;
        if let Some(path) = path {
            if let Some(extension) = path.extension().and_then(|value| value.to_str()) {
                if let Some(expected) = ImageMimeType::from_extension(extension) {
                    if expected != detected {
                        return Err(ToolContentError::invalid(
                            "image extension does not match its content",
                        ));
                    }
                }
            }
        }
        if let Some(declared_mime) = declared_mime {
            let declared = ImageMimeType::from_str(declared_mime).ok_or_else(|| {
                ToolContentError::invalid("image declares an unsupported MIME type")
            })?;
            if declared != detected {
                return Err(ToolContentError::invalid(
                    "image MIME type does not match its content",
                ));
            }
        }
        let _decode_guard = IMAGE_DECODE_LOCK.lock();
        validate_image(detected, &data)?;
        Ok(Self {
            mime_type: detected,
            data: Bytes::from(data),
            _reservation: Arc::new(reservation),
        })
    }
    pub(crate) fn from_base64(
        encoded: &str,
        declared_mime: &str,
    ) -> Result<Self, ToolContentError> {
        if encoded.len() > MAX_BASE64_BYTES {
            return Err(ToolContentError::limit(
                "image base64 exceeds the encoded size limit",
            ));
        }
        let reservation = reserve_image_memory(encoded.len().div_ceil(4) * 3)?;
        let data = BASE64
            .decode(encoded.as_bytes())
            .map_err(|_| ToolContentError::invalid("image data is not valid base64"))?;
        Self::validate_reserved(data, None, Some(declared_mime), reservation)
    }

    pub fn mime_type(&self) -> ImageMimeType {
        self.mime_type
    }

    pub fn data(&self) -> &[u8] {
        &self.data
    }

    #[cfg(test)]
    fn storage_ptr(&self) -> *const u8 {
        self.data.as_ptr()
    }
}

impl Serialize for ToolImage {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        #[derive(Serialize)]
        struct WireImage<'a> {
            mime_type: ImageMimeType,
            data: &'a str,
        }

        let encoded = BASE64.encode(&self.data);
        WireImage {
            mime_type: self.mime_type,
            data: &encoded,
        }
        .serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for ToolImage {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        struct WireImage<'a> {
            mime_type: ImageMimeType,
            #[serde(borrow)]
            data: Cow<'a, str>,
        }

        let wire: WireImage<'de> = WireImage::deserialize(deserializer)?;
        Self::from_base64(&wire.data, wire.mime_type.as_str()).map_err(D::Error::custom)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ToolContentPart {
    Text(String),
    Image(ToolImage),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolContent(ToolContentRepr);

#[derive(Debug, Clone, PartialEq, Eq)]
enum ToolContentRepr {
    Text(String),
    Parts(Vec<ToolContentPart>),
}

#[cfg(feature = "openapi")]
#[derive(Serialize, utoipa::ToSchema)]
#[serde(untagged)]
#[allow(dead_code)]
pub(crate) enum ToolContentSchema {
    Text(String),
    Parts(Vec<ToolContentPartSchema>),
}

#[cfg(feature = "openapi")]
#[derive(Serialize, utoipa::ToSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
#[allow(dead_code)]
pub(crate) enum ToolContentPartSchema {
    Text { text: String },
    Image { image: ToolImageSchema },
}

#[cfg(feature = "openapi")]
#[derive(Serialize, utoipa::ToSchema)]
#[allow(dead_code)]
pub(crate) struct ToolImageSchema {
    mime_type: String,
    data: String,
}
impl ToolContent {
    pub fn text(value: impl Into<String>) -> Self {
        Self(ToolContentRepr::Text(value.into()))
    }

    pub(crate) fn from_parts(parts: Vec<ToolContentPart>) -> Result<Self, ToolContentError> {
        let mut normalized = Vec::with_capacity(parts.len());
        for part in parts {
            match part {
                ToolContentPart::Text(text) if text.is_empty() => {}
                ToolContentPart::Text(text) => match normalized.last_mut() {
                    Some(ToolContentPart::Text(existing)) => existing.push_str(&text),
                    _ => normalized.push(ToolContentPart::Text(text)),
                },
                ToolContentPart::Image(image) => normalized.push(ToolContentPart::Image(image)),
            }
        }
        let stats = image_stats_parts(&normalized);
        validate_result_stats(stats)?;
        if stats.count == 0 {
            let text = normalized
                .into_iter()
                .filter_map(|part| match part {
                    ToolContentPart::Text(text) => Some(text),
                    ToolContentPart::Image(_) => None,
                })
                .collect::<String>();
            Ok(Self(ToolContentRepr::Text(text)))
        } else {
            Ok(Self(ToolContentRepr::Parts(normalized)))
        }
    }

    pub fn as_text(&self) -> Option<&str> {
        match &self.0 {
            ToolContentRepr::Text(text) => Some(text),
            ToolContentRepr::Parts(_) => None,
        }
    }

    pub fn parts(&self) -> Option<&[ToolContentPart]> {
        match &self.0 {
            ToolContentRepr::Text(_) => None,
            ToolContentRepr::Parts(parts) => Some(parts),
        }
    }

    pub fn contains_images(&self) -> bool {
        matches!(self.0, ToolContentRepr::Parts(_))
    }

    pub fn contains(&self, needle: &str) -> bool {
        match &self.0 {
            ToolContentRepr::Text(text) => text.contains(needle),
            ToolContentRepr::Parts(_) => self.preview().contains(needle),
        }
    }

    pub fn len(&self) -> usize {
        self.estimated_encoded_len()
    }

    pub fn is_empty(&self) -> bool {
        match &self.0 {
            ToolContentRepr::Text(text) => text.is_empty(),
            ToolContentRepr::Parts(parts) => parts.is_empty(),
        }
    }

    pub(crate) fn image_stats(&self) -> ImageStats {
        match &self.0 {
            ToolContentRepr::Text(_) => ImageStats::default(),
            ToolContentRepr::Parts(parts) => image_stats_parts(parts),
        }
    }

    pub fn preview(&self) -> String {
        match &self.0 {
            ToolContentRepr::Text(text) => text.clone(),
            ToolContentRepr::Parts(parts) => parts
                .iter()
                .map(|part| match part {
                    ToolContentPart::Text(text) => text.clone(),
                    ToolContentPart::Image(image) => format!(
                        "[image: {}, {} bytes]",
                        image.mime_type().as_str(),
                        image.data().len()
                    ),
                })
                .collect::<Vec<_>>()
                .join("\n"),
        }
    }

    pub(crate) fn estimated_encoded_len(&self) -> usize {
        match &self.0 {
            ToolContentRepr::Text(text) => text.len(),
            ToolContentRepr::Parts(parts) => parts.iter().fold(0usize, |total, part| {
                total.saturating_add(match part {
                    ToolContentPart::Text(text) => text.len(),
                    ToolContentPart::Image(image) => image.data().len().div_ceil(3) * 4,
                })
            }),
        }
    }
}

impl From<String> for ToolContent {
    fn from(value: String) -> Self {
        Self::text(value)
    }
}

impl From<&str> for ToolContent {
    fn from(value: &str) -> Self {
        Self::text(value)
    }
}
impl PartialEq<str> for ToolContent {
    fn eq(&self, other: &str) -> bool {
        self.as_text() == Some(other)
    }
}

impl PartialEq<&str> for ToolContent {
    fn eq(&self, other: &&str) -> bool {
        self.as_text() == Some(*other)
    }
}

impl fmt::Display for ToolContent {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.preview())
    }
}

impl Serialize for ToolContent {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match &self.0 {
            ToolContentRepr::Text(text) => serializer.serialize_str(text),
            ToolContentRepr::Parts(parts) => {
                #[derive(Serialize)]
                #[serde(tag = "type", rename_all = "snake_case")]
                enum WirePart<'a> {
                    Text { text: &'a str },
                    Image { image: &'a ToolImage },
                }
                let wire: Vec<_> = parts
                    .iter()
                    .map(|part| match part {
                        ToolContentPart::Text(text) => WirePart::Text { text },
                        ToolContentPart::Image(image) => WirePart::Image { image },
                    })
                    .collect();
                wire.serialize(serializer)
            }
        }
    }
}

impl<'de> Deserialize<'de> for ToolContent {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(tag = "type", rename_all = "snake_case")]
        enum WirePart {
            Text { text: String },
            Image { image: ToolImage },
        }
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum WireContent {
            Text(String),
            Parts(Vec<WirePart>),
        }

        match WireContent::deserialize(deserializer)? {
            WireContent::Text(text) => Ok(Self::text(text)),
            WireContent::Parts(parts) => Self::from_parts(
                parts
                    .into_iter()
                    .map(|part| match part {
                        WirePart::Text { text } => ToolContentPart::Text(text),
                        WirePart::Image { image } => ToolContentPart::Image(image),
                    })
                    .collect(),
            )
            .map_err(D::Error::custom),
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct ImageStats {
    pub count: usize,
    pub bytes: usize,
}

impl ImageStats {
    pub(crate) fn checked_add(self, other: Self) -> Result<Self, ToolContentError> {
        let stats = Self {
            count: self.count.saturating_add(other.count),
            bytes: self.bytes.saturating_add(other.bytes),
        };
        if stats.count > MAX_TRANSCRIPT_IMAGES || stats.bytes > MAX_TRANSCRIPT_IMAGE_BYTES {
            Err(ToolContentError::limit(format!(
                "image history exceeds {MAX_TRANSCRIPT_IMAGES} images or {MAX_TRANSCRIPT_IMAGE_BYTES} bytes"
            )))
        } else {
            Ok(stats)
        }
    }
}

fn image_stats_parts(parts: &[ToolContentPart]) -> ImageStats {
    parts.iter().fold(ImageStats::default(), |mut stats, part| {
        if let ToolContentPart::Image(image) = part {
            stats.count = stats.count.saturating_add(1);
            stats.bytes = stats.bytes.saturating_add(image.data().len());
        }
        stats
    })
}

fn validate_result_stats(stats: ImageStats) -> Result<(), ToolContentError> {
    if stats.count > MAX_IMAGES_PER_RESULT {
        return Err(ToolContentError::limit(format!(
            "tool result exceeds the {MAX_IMAGES_PER_RESULT} image limit"
        )));
    }
    if stats.bytes > MAX_RESULT_IMAGE_BYTES {
        return Err(ToolContentError::limit(format!(
            "tool result exceeds the {MAX_RESULT_IMAGE_BYTES} image byte limit"
        )));
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ToolContentError {
    code: &'static str,
    message: String,
}

impl ToolContentError {
    fn invalid(message: impl Into<String>) -> Self {
        Self {
            code: "invalid_image",
            message: message.into(),
        }
    }

    fn limit(message: impl Into<String>) -> Self {
        Self {
            code: "image_limit_exceeded",
            message: message.into(),
        }
    }

    pub(crate) fn code(&self) -> &'static str {
        self.code
    }

    pub(crate) fn message(&self) -> &str {
        &self.message
    }
}

impl fmt::Display for ToolContentError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for ToolContentError {}

pub(crate) fn is_image_candidate(path: &Path, header: &[u8]) -> bool {
    detect_supported_image(header).is_some()
        || path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|extension| ImageMimeType::from_extension(extension).is_some())
        || image::guess_format(header).is_ok()
}

fn detect_supported_image(content: &[u8]) -> Option<ImageMimeType> {
    if content.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some(ImageMimeType::Png)
    } else if content.starts_with(&[0xff, 0xd8, 0xff]) {
        Some(ImageMimeType::Jpeg)
    } else if content.starts_with(b"GIF87a") || content.starts_with(b"GIF89a") {
        Some(ImageMimeType::Gif)
    } else if content.len() >= 12 && content.starts_with(b"RIFF") && &content[8..12] == b"WEBP" {
        Some(ImageMimeType::WebP)
    } else {
        None
    }
}

fn decode_limits() -> Limits {
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_IMAGE_DIMENSION);
    limits.max_image_height = Some(MAX_IMAGE_DIMENSION);
    limits.max_alloc = Some(MAX_DECODE_BYTES);
    limits
}

fn validate_image(format: ImageMimeType, content: &[u8]) -> Result<(), ToolContentError> {
    match format {
        ImageMimeType::Png => {
            let decoder = PngDecoder::new(Cursor::new(content))
                .map_err(|error| invalid_format("PNG", error))?;
            let decoder = bounded_decoder(decoder, "PNG")?;
            if decoder
                .is_apng()
                .map_err(|error| invalid_format("PNG", error))?
            {
                return Err(ToolContentError::invalid(
                    "animated PNG images are unsupported",
                ));
            }
            decode_still(decoder, "PNG")
        }
        ImageMimeType::Jpeg => {
            let decoder = JpegDecoder::new(Cursor::new(content))
                .map_err(|error| invalid_format("JPEG", error))?;
            let decoder = bounded_decoder(decoder, "JPEG")?;
            decode_still(decoder, "JPEG")
        }
        ImageMimeType::WebP => {
            let decoder = WebPDecoder::new(BufReader::new(Cursor::new(content)))
                .map_err(|error| invalid_format("WebP", error))?;
            let decoder = bounded_decoder(decoder, "WebP")?;
            if decoder.has_animation() {
                return Err(ToolContentError::invalid(
                    "animated WebP images are unsupported",
                ));
            }
            decode_still(decoder, "WebP")
        }
        ImageMimeType::Gif => validate_static_gif(content),
    }
}

fn bounded_decoder<D: ImageDecoder>(mut decoder: D, format: &str) -> Result<D, ToolContentError> {
    decoder
        .set_limits(decode_limits())
        .map_err(|error| invalid_format(format, error))?;
    validate_dimensions(decoder.dimensions())?;
    Ok(decoder)
}

fn decode_still<D: ImageDecoder>(decoder: D, format: &str) -> Result<(), ToolContentError> {
    let decoded_bytes = decoder.total_bytes();
    if decoded_bytes > MAX_DECODE_BYTES {
        return Err(ToolContentError::limit(
            "decoded image exceeds the memory limit",
        ));
    }
    let length = usize::try_from(decoded_bytes)
        .map_err(|_| ToolContentError::limit("decoded image is too large"))?;
    let mut buffer = vec![0; length];
    decoder
        .read_image(&mut buffer)
        .map_err(|error| invalid_format(format, error))?;
    Ok(())
}

fn validate_static_gif(content: &[u8]) -> Result<(), ToolContentError> {
    let decoder = GifDecoder::new(BufReader::new(Cursor::new(content)))
        .map_err(|error| invalid_format("GIF", error))?;
    let decoder = bounded_decoder(decoder, "GIF")?;
    let mut frames = decoder.into_frames();
    match frames.next() {
        Some(Ok(_)) => {}
        Some(Err(error)) => return Err(invalid_format("GIF", error)),
        None => return Err(ToolContentError::invalid("GIF image contains no frames")),
    }
    match frames.next() {
        Some(Ok(_)) => Err(ToolContentError::invalid(
            "animated GIF images are unsupported",
        )),
        Some(Err(error)) => Err(invalid_format("GIF", error)),
        None => Ok(()),
    }
}

fn validate_dimensions((width, height): (u32, u32)) -> Result<(), ToolContentError> {
    let pixels = u64::from(width) * u64::from(height);
    if width == 0
        || height == 0
        || width > MAX_IMAGE_DIMENSION
        || height > MAX_IMAGE_DIMENSION
        || pixels > MAX_IMAGE_PIXELS
    {
        return Err(ToolContentError::limit(
            "image dimensions exceed the decoded image bounds",
        ));
    }
    Ok(())
}

fn invalid_format(format: &str, error: impl fmt::Display) -> ToolContentError {
    ToolContentError::invalid(format!("image contains invalid {format} data: {error}"))
}

#[cfg(test)]
mod tests {
    use image::{DynamicImage, ImageBuffer, ImageFormat, Rgba};

    use super::*;

    fn image_bytes(format: ImageFormat) -> Vec<u8> {
        let image = DynamicImage::ImageRgba8(ImageBuffer::from_pixel(2, 2, Rgba([1, 2, 3, 255])));
        let mut bytes = Cursor::new(Vec::new());
        image.write_to(&mut bytes, format).unwrap();
        bytes.into_inner()
    }

    #[test]
    fn text_content_uses_legacy_scalar_wire_shape() {
        let content = ToolContent::text("hello");
        assert_eq!(serde_json::to_string(&content).unwrap(), "\"hello\"");
        assert_eq!(
            serde_json::from_str::<ToolContent>("\"hello\"").unwrap(),
            content
        );
    }

    #[test]
    fn image_content_round_trips_and_clones_without_copying_bytes() {
        let image = ToolImage::validate(image_bytes(ImageFormat::Png), None, None).unwrap();
        let content = ToolContent::from_parts(vec![ToolContentPart::Image(image)]).unwrap();
        let cloned = content.clone();
        let encoded = serde_json::to_string(&content).unwrap();
        let decoded: ToolContent = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded, content);
        let image = match content.parts().unwrap().first().unwrap() {
            ToolContentPart::Image(image) => image,
            ToolContentPart::Text(_) => unreachable!(),
        };
        let cloned_image = match cloned.parts().unwrap().first().unwrap() {
            ToolContentPart::Image(image) => image,
            ToolContentPart::Text(_) => unreachable!(),
        };
        assert_eq!(image.storage_ptr(), cloned_image.storage_ptr());
    }

    #[test]
    fn supported_still_formats_validate() {
        for format in [
            ImageFormat::Png,
            ImageFormat::Jpeg,
            ImageFormat::WebP,
            ImageFormat::Gif,
        ] {
            ToolImage::validate(image_bytes(format), None, None).unwrap();
        }
    }

    #[test]
    fn mime_and_extension_mismatches_are_rejected() {
        let png = image_bytes(ImageFormat::Png);
        assert!(ToolImage::validate(png.clone(), Some(Path::new("wrong.jpg")), None).is_err());
        assert!(ToolImage::validate(png, None, Some("image/jpeg")).is_err());
    }

    #[test]
    fn malformed_unsupported_and_animated_images_are_rejected() {
        assert!(ToolImage::validate(b"\x89PNG\r\n\x1a\nbroken".to_vec(), None, None).is_err());

        assert!(ToolImage::validate(b"BMunsupported".to_vec(), None, None).is_err());

        let mut animated = Cursor::new(Vec::new());
        {
            use image::codecs::gif::GifEncoder;
            use image::{Frame, RgbaImage};

            let mut encoder = GifEncoder::new(&mut animated);
            encoder
                .encode_frame(Frame::new(RgbaImage::from_pixel(
                    1,
                    1,
                    Rgba([1, 2, 3, 255]),
                )))
                .unwrap();
            encoder
                .encode_frame(Frame::new(RgbaImage::from_pixel(
                    1,
                    1,
                    Rgba([4, 5, 6, 255]),
                )))
                .unwrap();
        }
        assert!(ToolImage::validate(animated.into_inner(), None, None).is_err());
    }

    #[test]
    fn per_result_and_history_image_count_limits_are_enforced() {
        let image = ToolImage::validate(image_bytes(ImageFormat::Png), None, None).unwrap();
        let max_result = ToolContent::from_parts(
            (0..MAX_IMAGES_PER_RESULT)
                .map(|_| ToolContentPart::Image(image.clone()))
                .collect(),
        )
        .unwrap();
        assert_eq!(max_result.image_stats().count, MAX_IMAGES_PER_RESULT);
        assert!(ToolContent::from_parts(
            (0..=MAX_IMAGES_PER_RESULT)
                .map(|_| ToolContentPart::Image(image.clone()))
                .collect(),
        )
        .is_err());

        let half = ToolContent::from_parts(
            (0..MAX_TRANSCRIPT_IMAGES / 2)
                .map(|_| ToolContentPart::Image(image.clone()))
                .collect(),
        )
        .unwrap();
        let half_stats = half.image_stats();
        let full = half_stats.checked_add(half_stats).unwrap();
        assert_eq!(full.count, MAX_TRANSCRIPT_IMAGES);
        assert!(full
            .checked_add(
                ToolContent::from_parts(vec![ToolContentPart::Image(image)])
                    .unwrap()
                    .image_stats(),
            )
            .is_err());
        assert!(reserve_image_memory(MAX_RESIDENT_IMAGE_BYTES + 1).is_err());
    }
}
