use super::attention_contracts::AttentionFrame;
use crate::application::attention_runtime::NativeAttentionActivity;
use crate::{
    application::attention::{
        AttentionBoundary, AttentionRead, AttentionSubscribeError, AttentionSubscription,
    },
    ApiError, ApiErrorBody, SessionManager,
};
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::sse::{Event, Sse},
};
use std::convert::Infallible;

fn forbidden() -> ApiError {
    ApiError::new(
        StatusCode::FORBIDDEN,
        "native attention origin is not authorized".into(),
    )
}
fn single<'a>(headers: &'a HeaderMap, name: &str) -> Result<Option<&'a str>, ApiError> {
    let mut values = headers.get_all(name).iter();
    let value = values
        .next()
        .map(|value| value.to_str().map_err(|_| forbidden()))
        .transpose()?;
    if values.next().is_some() {
        return Err(forbidden());
    }
    Ok(value)
}
fn guard(manager: &SessionManager, headers: &HeaderMap) -> Result<(), ApiError> {
    let authority = manager.inner.attention.authority().ok_or_else(|| {
        ApiError::new(
            StatusCode::NOT_FOUND,
            "native attention is unavailable".into(),
        )
    })?;
    if single(headers, "host")? != Some(authority.as_str()) {
        return Err(forbidden());
    }
    if single(headers, "origin")?.is_some_and(|origin| origin != format!("http://{authority}")) {
        return Err(forbidden());
    }
    if single(headers, "sec-fetch-site")?
        .is_some_and(|site| !matches!(site, "same-origin" | "none"))
    {
        return Err(forbidden());
    }
    Ok(())
}
fn cursor(headers: &HeaderMap) -> Result<Option<AttentionBoundary>, ApiError> {
    let Some(raw) = single(headers, "last-event-id")? else {
        return Ok(None);
    };
    let invalid = || ApiError::bad_request("invalid attention cursor".into());
    if raw.len() > 100 {
        return Err(invalid());
    }
    let mut parts = raw.split(':');
    let engine = parts
        .next()
        .ok_or_else(invalid)?
        .parse()
        .map_err(|_| invalid())?;
    let epoch = parts
        .next()
        .ok_or_else(invalid)?
        .parse()
        .map_err(|_| invalid())?;
    let sequence = parts
        .next()
        .ok_or_else(invalid)?
        .parse()
        .map_err(|_| invalid())?;
    if parts.next().is_some() {
        return Err(invalid());
    }
    Ok(Some(AttentionBoundary {
        engine,
        epoch,
        sequence,
    }))
}

fn completion_cursor(
    headers: &HeaderMap,
) -> Result<Option<Option<nac_core::store::CompletionCursor>>, ApiError> {
    let Some(raw) = single(headers, "x-nac-completion-cursor")? else {
        return Ok(None);
    };
    if raw == "new" {
        return Ok(Some(None));
    }
    let invalid = || ApiError::bad_request("invalid completion cursor".into());
    if raw.len() > 100 {
        return Err(invalid());
    }
    let (store, sequence) = raw.split_once(':').ok_or_else(invalid)?;
    let store = uuid::Uuid::parse_str(store)
        .map_err(|_| invalid())?
        .to_string();
    let sequence = sequence.parse::<i64>().map_err(|_| invalid())?;
    if sequence < 0 {
        return Err(invalid());
    }
    Ok(Some(Some(nac_core::store::CompletionCursor {
        store,
        sequence,
    })))
}
fn event(frame: AttentionFrame, boundary: Option<AttentionBoundary>) -> Result<Event, Infallible> {
    // All strings are bounded metadata identities; serde has no fallible custom
    // serializer here. Keep serialization failure explicit instead of panicking.
    let mut event = Event::default().event("attention");
    if let Some(boundary) = boundary {
        event = event.id(format!(
            "{}:{}:{}",
            boundary.engine, boundary.epoch, boundary.sequence
        ));
    }
    Ok(match event.json_data(frame) {
        Ok(event) => event,
        Err(_) => Event::default()
            .event("attention_unavailable")
            .data("serialization"),
    })
}

/// Drain ready current-state controls before history without waiting for an
/// unrelated projection change. `next` checks retained state before awaiting.
async fn ready(subscription: &mut AttentionSubscription) -> Option<AttentionRead> {
    tokio::select! {
        biased;
        record = subscription.next() => Some(record),
        _ = std::future::ready(()) => None,
    }
}

#[utoipa::path(get,path="/attention/events",operation_id="get_attention_events",tag="native",
params(("Last-Event-ID"=Option<String>,Header,description="Engine UUID:projection UUID:sequence cursor"),
("X-NAC-Completion-Cursor"=Option<String>,Header,description="Native semantic replay: new cutoff or stable store UUID:sequence; independent from current-state baseline")),
responses((status=200,description="Native-only bounded metadata SSE; baseline is silent",body=AttentionFrame,content_type="text/event-stream"),
(status=400,body=ApiErrorBody),(status=403,body=ApiErrorBody),(status=404,body=ApiErrorBody),(status=409,body=ApiErrorBody),(status=503,body=ApiErrorBody)))]
pub(crate) async fn events(
    State(manager): State<SessionManager>,
    headers: HeaderMap,
) -> Result<Sse<impl futures_core::Stream<Item = Result<Event, Infallible>>>, ApiError> {
    // Generic mutation middleware skips GET. These checks precede reservation,
    // store subscription, bootstrap, service binding and all canonical reads.
    guard(&manager, &headers)?;
    let cursor = cursor(&headers)?;
    let completion_cursor = completion_cursor(&headers)?;
    let mut observer = manager
        .inner
        .attention
        .open(manager.clone(), cursor)
        .await
        .map_err(|error| match error {
            AttentionSubscribeError::Busy => ApiError::new(
                StatusCode::CONFLICT,
                "native attention observer is busy".into(),
            ),
            AttentionSubscribeError::Unavailable(_) => ApiError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "native attention requires a new baseline".into(),
            ),
        })?;
    let first_page = if let Some(after) = completion_cursor {
        Some(observer.completions(&manager, after).await.map_err(|_| {
            ApiError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "completion replay is unavailable".into(),
            )
        })?)
    } else {
        None
    };
    Ok(Sse::new(async_stream::stream! {
        let mut completion_after=first_page.as_ref().map(|page|page.cursor.clone());
        if observer.is_closed() {
            if let Some(AttentionRead::Reset(reason))=ready(observer.subscription()).await {
                yield event(AttentionFrame::Reset{reason:reason.into()},None);
            }
            return;
        }
        if let Some(page)=first_page {yield event(AttentionFrame::Completions{page:page.into()},None);}
        yield event(AttentionFrame::baseline(&observer.subscription().initial),Some(observer.subscription().initial.boundary));
        for record in std::mem::take(&mut observer.subscription().initial.replay) {
            yield event(AttentionFrame::record(&record),Some(record.boundary));
        }
        observer.subscription().initial.baseline.clear();
        loop {
            if let Some(record)=ready(observer.subscription()).await {
                match record {
                    AttentionRead::Record(record)=>yield event(AttentionFrame::record(&record),Some(record.boundary)),
                    AttentionRead::Reset(reason)=>{yield event(AttentionFrame::Reset{reason:reason.into()},None);break;},
                    AttentionRead::Closed=>break,
                }
                continue;
            }
            if let Some(after)=completion_after.as_ref() {
                let result=observer.completions(&manager,Some(after.clone())).await;
                // The read may suspend while the observation retires or current
                // state changes. Never emit its history ahead of that control.
                if let Some(record)=ready(observer.subscription()).await {
                    match record {
                        AttentionRead::Record(record)=>yield event(AttentionFrame::record(&record),Some(record.boundary)),
                        AttentionRead::Reset(reason)=>{yield event(AttentionFrame::Reset{reason:reason.into()},None);break;},
                        AttentionRead::Closed=>break,
                    }
                    continue;
                }
                match result {
                    Ok(page)=>{
                        let changed=page.cursor.sequence!=after.sequence;
                        completion_after=Some(page.cursor.clone());
                        if changed {
                            yield event(AttentionFrame::Completions{page:page.into()},None);
                            continue;
                        }
                    },
                    Err(_)=>{yield event(AttentionFrame::Reset{reason:crate::application::attention::AttentionReset::ReplayGap.into()},None);break;}
                }
            }
            // An empty page waits once before another canonical read; bounded
            // pages with an advancing cursor drain without this fallback delay.
            let record=if completion_after.is_some() {
                #[cfg(test)]
                observer.before_history_wait_for_test().await;
                tokio::select! {
                    biased;
                    activity=observer.next_activity()=>match activity {
                        NativeAttentionActivity::Current(record)=>Some(record),
                        NativeAttentionActivity::Dirty=>None,
                    },
                    _=tokio::time::sleep(std::time::Duration::from_secs(5))=>None,
                }
            } else {Some(observer.subscription().next().await)};
            if let Some(record)=record {
                match record {
                    AttentionRead::Record(record)=>yield event(AttentionFrame::record(&record),Some(record.boundary)),
                    AttentionRead::Reset(reason)=>{yield event(AttentionFrame::Reset{reason:reason.into()},None);break;},
                    AttentionRead::Closed=>break,
                }
            }
        }
    }))
}

#[cfg(test)]
#[path = "attention_tests.rs"]
mod tests;
