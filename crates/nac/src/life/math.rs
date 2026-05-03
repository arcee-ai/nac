/// Generate a deterministic seed from prompt and dimensions
pub fn hash_seed(prompt: &str, width: usize, height: usize, version: &str) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new();
    hasher.update(version.as_bytes());
    hasher.update(prompt.as_bytes());
    hasher.update(&width.to_le_bytes());
    hasher.update(&height.to_le_bytes());
    hasher.finalize().into()
}

/// Wraps an index with a delta, handling toroidal boundaries.
///
/// # Arguments
/// * `index` - Starting index
/// * `delta` - Offset to apply (can be negative)
/// * `len` - Length of the dimension
///
/// # Returns
/// Wrapped index within [0, len)
pub fn wrap_index(index: usize, delta: isize, len: usize) -> usize {
    if len == 0 {
        return 0;
    }
    ((index as isize + delta).rem_euclid(len as isize)) as usize
}

/// Wraps a signed index, handling toroidal boundaries.
///
/// # Arguments
/// * `index` - Signed index (can be negative)
/// * `len` - Length of the dimension
///
/// # Returns
/// Wrapped index within [0, len)
pub fn wrap_index_signed(index: isize, len: usize) -> usize {
    if len == 0 {
        return 0;
    }
    index.rem_euclid(len as isize) as usize
}

/// Calculates dimensions after rotation.
///
/// # Arguments
/// * `width` - Original width
/// * `height` - Original height
/// * `rotation` - Rotation in 90-degree increments (0-3)
///
/// # Returns
/// (width, height) after rotation
pub fn rotated_dimensions(width: usize, height: usize, rotation: u8) -> (usize, usize) {
    if rotation % 2 == 0 {
        (width, height)
    } else {
        (height, width)
    }
}

/// Rotates a cell coordinate within a pattern.
///
/// # Arguments
/// * `x` - Original X coordinate
/// * `y` - Original Y coordinate
/// * `width` - Pattern width
/// * `height` - Pattern height
/// * `rotation` - Rotation in 90-degree increments (0-3)
///
/// # Returns
/// Rotated (x, y) coordinates
pub fn rotate_cell(
    x: usize,
    y: usize,
    width: usize,
    height: usize,
    rotation: u8,
) -> (usize, usize) {
    match rotation % 4 {
        0 => (x, y),
        1 => (height.saturating_sub(1).saturating_sub(y), x),
        2 => (
            width.saturating_sub(1).saturating_sub(x),
            height.saturating_sub(1).saturating_sub(y),
        ),
        _ => (y, width.saturating_sub(1).saturating_sub(x)),
    }
}
