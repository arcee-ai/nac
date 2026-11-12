/* Bounded CVE-2026-55199 malformed EXT_INFO parser-state probe. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "libssh2_priv.h"
#include "packet.h"

static void *probe_alloc(size_t size, void **opaque)
{
    (void)opaque;
    return malloc(size);
}

static void probe_free(void *ptr, void **opaque)
{
    (void)opaque;
    free(ptr);
}

static void *probe_realloc(void *ptr, size_t size, void **opaque)
{
    (void)opaque;
    return realloc(ptr, size);
}

int main(void)
{
    LIBSSH2_SESSION session;
    unsigned char *packet;
    const unsigned char malformed[] = {
        SSH_MSG_EXT_INFO,
        0, 0, 0, 1,          /* one extension */
        0, 0, 0, 15,         /* name length */
        's','e','r','v','e','r','-','s','i','g','-','a','l','g','s',
        0, 0, 0, 1           /* value length says one, value is absent */
    };
    int rc;
    int created;

    memset(&session, 0, sizeof(session));
    session.alloc = probe_alloc;
    session.free = probe_free;
    session.realloc = probe_realloc;
    packet = malloc(sizeof(malformed));
    if(!packet)
        return 3;
    memcpy(packet, malformed, sizeof(malformed));
    rc = _libssh2_packet_add(&session, packet, sizeof(malformed),
                             LIBSSH2_MAC_CONFIRMED, 0);
    created = session.server_sign_algorithms != NULL;
    printf("packet_rc=%d malformed_value_created_algorithms=%d\n", rc,
           created);
    free(session.server_sign_algorithms);
    if(rc != 0)
        return 3;
    return created ? 1 : 0;
}
