//! Fresh pinned-peer ACK; 204 follows original Core cleanup acknowledgement.
use super::*;
use crate::application::create_terminal::AckEnvelope;

pub(in crate::delivery::managed_location_facts) const PATH: &str =
    "/internal/v1/managed-session-create/ack";
const MAX_ACK_BYTES: usize = 16 * 1024;

pub(in crate::delivery::managed_location_facts) async fn handle(
    State(manager): State<SessionManager>,
    request: Request,
) -> Response {
    let Some(ConnectInfo(peer)) = request
        .extensions()
        .get::<ConnectInfo<AuthenticatedRuntimePeer>>()
        .cloned()
    else {
        return refused(StatusCode::FORBIDDEN);
    };
    if request.uri().query().is_some()
        || single_header(request.headers(), "content-type") != Some("application/json")
        || single_header(request.headers(), "accept") != Some("application/json")
        || [
            "authorization",
            "cookie",
            "origin",
            "x-forwarded-client-cert",
        ]
        .iter()
        .any(|h| request.headers().contains_key(*h))
    {
        return refused(StatusCode::BAD_REQUEST);
    }
    let Some(request_id) = single_header(request.headers(), "x-nac-request-id").map(str::to_owned)
    else {
        return refused(StatusCode::BAD_REQUEST);
    };
    let if_match = match single_header(request.headers(), "if-match") {
        Some(value) => value.to_owned(),
        None if request.headers().contains_key("if-match") => {
            return refused(StatusCode::BAD_REQUEST)
        }
        None => return refused(StatusCode::PRECONDITION_REQUIRED),
    };
    // This fresh ACK-only bound never renews CREATE admission or its runtime.
    let Some(deadline) = FactDeadline::from_headers(request.headers()) else {
        return refused(StatusCode::FORBIDDEN);
    };
    let operation = match uuid::Uuid::parse_str(&request_id) {
        Ok(id) if !id.is_nil() && id.to_string() == request_id => id,
        _ => return refused(StatusCode::BAD_REQUEST),
    };
    // Capture actual CREATE-purpose enrollment and one-use connection before
    // body polling. A marker, copied peer view or later cutoff cannot replace it.
    let exchange = match peer
        .original()
        .begin_create_ack(operation, deadline.epoch_ms)
    {
        Ok(exchange) => exchange,
        Err(_) => return refused(StatusCode::FORBIDDEN),
    };
    let shutdown = request.extensions().get::<ObservationShutdown>().cloned();
    if shutdown.as_ref().is_some_and(|s| *s.0.borrow()) {
        return refused(StatusCode::SERVICE_UNAVAILABLE);
    }
    let body = match tokio::time::timeout_at(
        exchange.original_cutoff().into(),
        to_bytes(request.into_body(), MAX_ACK_BYTES),
    )
    .await
    {
        Ok(Ok(body)) => body,
        Ok(Err(_)) => return refused(StatusCode::PAYLOAD_TOO_LARGE),
        Err(_) => return refused(StatusCode::SERVICE_UNAVAILABLE),
    };
    let exchange = match exchange.bind_body(body.to_vec().into_boxed_slice()) {
        Ok(exchange) => exchange,
        Err(_) => return refused(StatusCode::SERVICE_UNAVAILABLE),
    };
    let ack: AckEnvelope = match serde_json::from_slice(exchange.payload()) {
        Ok(ack) => ack,
        Err(_) => return refused(StatusCode::BAD_REQUEST),
    };
    if ack.operation_id() != request_id
        || !deadline.is_live()
        || shutdown.as_ref().is_some_and(|s| *s.0.borrow())
    {
        return refused(StatusCode::PRECONDITION_FAILED);
    }
    match manager
        .session_creation()
        .acknowledge_create_terminal(&ack, &if_match, exchange)
        .await
    {
        Ok(()) => (
            StatusCode::NO_CONTENT,
            [
                (header::CACHE_CONTROL, "no-store"),
                (header::CONTENT_LENGTH, "0"),
            ],
        )
            .into_response(),
        Err(_) => refused(StatusCode::SERVICE_UNAVAILABLE),
    }
}
