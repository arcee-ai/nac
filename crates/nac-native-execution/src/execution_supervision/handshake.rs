//! Closed version/nonce codec only. Physical ownership stays at the caller.
use super::*;

pub(super) async fn exchange(
    stream: &mut (impl AsyncRead + AsyncWrite + Unpin + Send),
    boot_id: Uuid,
    initiator: bool,
    wire_protocol: &str,
) -> Result<Uuid> {
    let (peer_boot, challenge) = if initiator {
        let challenge = Uuid::new_v4();
        write_frame(
            stream,
            &Frame::Hello {
                protocol: wire_protocol.into(),
                boot_id,
                challenge_id: challenge,
            },
        )
        .await?;
        match read_frame(stream).await? {
            Frame::Welcome {
                protocol,
                boot_id: peer_boot,
                challenge_id,
            } if protocol == wire_protocol && challenge_id == challenge => (peer_boot, challenge),
            _ => bail!("execution supervision response mismatch"),
        }
    } else {
        let (peer_boot, challenge) = match read_frame(stream).await? {
            Frame::Hello {
                protocol,
                boot_id,
                challenge_id,
            } if protocol == wire_protocol => (boot_id, challenge_id),
            _ => bail!("execution supervision request mismatch"),
        };
        if peer_boot.is_nil() || peer_boot == boot_id || challenge.is_nil() {
            bail!("execution supervision identity unavailable");
        }
        write_frame(
            stream,
            &Frame::Welcome {
                protocol: wire_protocol.into(),
                boot_id,
                challenge_id: challenge,
            },
        )
        .await?;
        (peer_boot, challenge)
    };
    if peer_boot.is_nil() || peer_boot == boot_id || challenge.is_nil() {
        bail!("execution supervision identity unavailable");
    }
    Ok(peer_boot)
}
