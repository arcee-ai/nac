/* Bounded CVE-2026-55200 32-bit packet-length overflow probe. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "libssh2_priv.h"
#include "transport.h"

static size_t observed_alloc_count;
static size_t observed_alloc_size;

static void *probe_alloc(size_t size, void **opaque)
{
    (void)opaque;
    observed_alloc_count++;
    observed_alloc_size = size;
    /* Stop before a wrapped allocation can be used as a packet buffer. */
    return NULL;
}

static void probe_free(void *ptr, void **opaque)
{
    (void)ptr;
    (void)opaque;
}

static void *probe_realloc(void *ptr, size_t size, void **opaque)
{
    (void)ptr;
    (void)size;
    (void)opaque;
    return NULL;
}

static int huge_packet_len(LIBSSH2_SESSION *session, unsigned int seqno,
                           unsigned char *data, size_t data_size,
                           unsigned int *len, void **opaque)
{
    (void)session;
    (void)seqno;
    (void)data;
    (void)data_size;
    (void)opaque;
    /* With 16 auth bytes, 4 + this length + 16 wraps to nine on i386. */
    *len = UINT32_MAX - 10;
    return LIBSSH2_ERROR_NONE;
}

int main(void)
{
    LIBSSH2_SESSION session;
    LIBSSH2_CRYPT_METHOD crypt;
    int rc;

    if(sizeof(size_t) != 4) {
        fprintf(stderr, "probe requires 32-bit size_t\n");
        return 3;
    }
    memset(&session, 0, sizeof(session));
    memset(&crypt, 0, sizeof(crypt));
    session.alloc = probe_alloc;
    session.free = probe_free;
    session.realloc = probe_realloc;
    session.state = LIBSSH2_STATE_NEWKEYS;
    crypt.blocksize = 16;
    crypt.auth_len = 16;
    crypt.flags = LIBSSH2_CRYPT_FLAG_REQUIRES_FULL_PACKET;
    crypt.get_len = huge_packet_len;
    session.remote.crypt = &crypt;
    session.packet.writeidx = 16;

    rc = _libssh2_transport_read(&session);
    printf("read_rc=%d packet_length=%u allocations=%zu first_size=%zu\n",
           rc, session.packet.packet_length,
           observed_alloc_count, observed_alloc_size);
    if(observed_alloc_count == 0 &&
       rc == LIBSSH2_ERROR_OUT_OF_BOUNDARY)
        return 0; /* fixed-side early bound */
    if(observed_alloc_count == 1 && observed_alloc_size == 9 &&
       rc == LIBSSH2_ERROR_ALLOC)
        return 1; /* vulnerable-side wrapped allocation attempt */
    return 3;
}
