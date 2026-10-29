/*
 * Seam-level malformed-input regressions for the six ALL-501 libssh2
 * corrections (CVE-2026-66032/66033/66034/66035/58050/58051).
 *
 * This harness is compiled inside the libssh2 build tree against the patched
 * sources and is never part of the shipped runtime. It drives each corrected
 * seam with the malformed input shape the correction rejects and asserts the
 * fixed behaviour. Every case runs in a forked child so that a regression to
 * the pre-patch behaviour is reported as a detected failure instead of
 * aborting the whole run.
 *
 * Build (see build-libssh2.sh):
 *   cc -I. -Isrc -Iinclude -o libssh2-regressions \
 *      libssh2-regressions.c src/publickey.c src/misc.c src/openssl.c \
 *      -lcrypto
 *
 * SPDX-License-Identifier: BSD-3-Clause
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/wait.h>

#include "libssh2_priv.h"
#include "sftp.h"

/* Response ids are private to src/publickey.c; mirror them here. */
#define LIBSSH2_PUBLICKEY_RESPONSE_STATUS    0
#define LIBSSH2_PUBLICKEY_RESPONSE_VERSION   1
#define LIBSSH2_PUBLICKEY_RESPONSE_PUBLICKEY 2

/* SFTP packet types are private to src/sftp.c; mirror the two used here. */
#define SSH_FXP_STATUS 101
#define SSH_FXP_HANDLE 102

/* ------------------------------------------------------------------ */
/* Deterministic allocator.                                            */
/*                                                                     */
/* Fresh bytes are filled with 0xAA so that an uninitialised list      */
/* entry is observable rather than accidentally zero. realloc grows    */
/* the tracked region and fills only the newly exposed tail.           */
/* ------------------------------------------------------------------ */

#define FILL_BYTE 0xAA

typedef union {
    size_t n;
    max_align_t align;
} alloc_hdr;

static void *t_alloc(size_t count, void **abstract)
{
    alloc_hdr *h;
    (void)abstract;
    h = malloc(sizeof(*h) + count);
    if(!h)
        return NULL;
    h->n = count;
    memset((unsigned char *)h + sizeof(*h), FILL_BYTE, count);
    return (unsigned char *)h + sizeof(*h);
}

static void t_free(void *ptr, void **abstract)
{
    (void)abstract;
    if(ptr)
        free((unsigned char *)ptr - sizeof(alloc_hdr));
}

static void *t_realloc(void *ptr, size_t count, void **abstract)
{
    alloc_hdr *h;
    size_t old;
    (void)abstract;
    if(!ptr)
        return t_alloc(count, abstract);
    h = (alloc_hdr *)((unsigned char *)ptr - sizeof(alloc_hdr));
    old = h->n;
    h = realloc(h, sizeof(*h) + count);
    if(!h)
        return NULL;
    h->n = count;
    if(count > old)
        memset((unsigned char *)h + sizeof(*h) + old, FILL_BYTE, count - old);
    return (unsigned char *)h + sizeof(*h);
}

/* ------------------------------------------------------------------ */
/* Crafted channel I/O.                                                */
/*                                                                     */
/* publickey_packet_receive() reads a 4-byte length then that many     */
/* bytes from the channel. The scripted reader below replays a byte    */
/* string so a malformed subsystem response can be delivered exactly.  */
/* ------------------------------------------------------------------ */

static const unsigned char *g_rx;
static size_t g_rx_len;
static size_t g_rx_off;

static void script_rx(const unsigned char *bytes, size_t len)
{
    g_rx = bytes;
    g_rx_len = len;
    g_rx_off = 0;
}

ssize_t _libssh2_channel_read(LIBSSH2_CHANNEL *channel, int stream_id,
                              char *buf, size_t buflen)
{
    size_t avail;
    (void)channel;
    (void)stream_id;
    if(g_rx_off >= g_rx_len)
        return 0;
    avail = g_rx_len - g_rx_off;
    if(avail > buflen)
        avail = buflen;
    memcpy(buf, g_rx + g_rx_off, avail);
    g_rx_off += avail;
    return (ssize_t)avail;
}

ssize_t _libssh2_channel_write(LIBSSH2_CHANNEL *channel, int stream_id,
                               const char *buf, size_t buflen)
{
    (void)channel;
    (void)stream_id;
    (void)buf;
    return (ssize_t)buflen;
}

int _libssh2_channel_close(LIBSSH2_CHANNEL *channel)
{
    (void)channel;
    return 0;
}

int _libssh2_channel_free(LIBSSH2_CHANNEL *channel)
{
    (void)channel;
    return 0;
}

int _libssh2_channel_extended_data(LIBSSH2_CHANNEL *channel, int ignore_mode)
{
    (void)channel;
    (void)ignore_mode;
    return 0;
}

LIBSSH2_CHANNEL *_libssh2_channel_open(LIBSSH2_SESSION *session,
                                       const char *channel_type,
                                       size_t channel_type_len,
                                       size_t window_size,
                                       size_t packet_size,
                                       const char *message,
                                       size_t message_len)
{
    (void)session;
    (void)channel_type;
    (void)channel_type_len;
    (void)window_size;
    (void)packet_size;
    (void)message;
    (void)message_len;
    return NULL;
}

int _libssh2_channel_process_startup(LIBSSH2_CHANNEL *channel,
                                     const char *request, size_t request_len,
                                     const char *message, size_t message_len)
{
    (void)channel;
    (void)request;
    (void)request_len;
    (void)message;
    (void)message_len;
    return 0;
}

int libssh2_session_last_errno(LIBSSH2_SESSION *session)
{
    return session ? session->err_code : LIBSSH2_ERROR_BAD_USE;
}

int _libssh2_wait_socket(LIBSSH2_SESSION *session, time_t entry_time)
{
    (void)session;
    (void)entry_time;
    return 0;
}

unsigned long libssh2_channel_window_read_ex(LIBSSH2_CHANNEL *channel,
                                             unsigned long *read_avail,
                                             unsigned long *window_size_initial)
{
    (void)channel;
    if(read_avail)
        *read_avail = 0;
    if(window_size_initial)
        *window_size_initial = 0x7FFFFFFF;
    return 0x7FFFFFFF;
}

/* ------------------------------------------------------------------ */
/* Fixture                                                             */
/* ------------------------------------------------------------------ */

typedef struct {
    LIBSSH2_SESSION session;
    LIBSSH2_CHANNEL channel;
    LIBSSH2_PUBLICKEY pkey;
} fixture;

static void fixture_init(fixture *f, uint32_t version)
{
    memset(f, 0, sizeof(*f));
    f->session.alloc = t_alloc;
    f->session.free = t_free;
    f->session.realloc = t_realloc;
    f->channel.session = &f->session;
    f->pkey.channel = &f->channel;
    f->pkey.version = version;
    f->pkey.listFetch_state = libssh2_NB_state_idle;
}

/* Big-endian helpers matching the wire format. */
static void put_u32(unsigned char *p, uint32_t v)
{
    p[0] = (unsigned char)(v >> 24);
    p[1] = (unsigned char)(v >> 16);
    p[2] = (unsigned char)(v >> 8);
    p[3] = (unsigned char)v;
}

/* The subsystem response id is a length-prefixed name, not a number. */
static size_t put_response_id(unsigned char *p, const char *name)
{
    size_t len = strlen(name);
    put_u32(p, (uint32_t)len);
    memcpy(p + 4, name, len);
    return 4 + len;
}

/* libssh2_publickey_list_fetch() returns -1 on every failure path and
   records the specific reason on the session. */
static int expect_error(fixture *f, int rc, int want, const char *what)
{
    if(rc != -1) {
        printf("     expected failure return, got %d\n", rc);
        return 1;
    }
    if(f->session.err_code != want) {
        printf("     expected %s (%d), got %d\n", what, want,
               f->session.err_code);
        return 1;
    }
    return 0;
}

/* ------------------------------------------------------------------ */
/* Case runner                                                         */
/* ------------------------------------------------------------------ */

typedef int (*case_fn)(void);

static int g_failures;

static void run_case(const char *name, case_fn fn)
{
    pid_t pid;
    int status = 0;

    fflush(stdout);
    pid = fork();
    if(pid < 0) {
        printf("FAIL %-46s fork failed\n", name);
        g_failures++;
        return;
    }
    if(pid == 0) {
        int rc = fn();
        fflush(stdout);
        _exit(rc == 0 ? 0 : 1);
    }
    if(waitpid(pid, &status, 0) < 0) {
        printf("FAIL %-46s waitpid failed\n", name);
        g_failures++;
        return;
    }
    if(WIFSIGNALED(status)) {
        printf("FAIL %-46s crashed with signal %d "
               "(pre-patch behaviour reached)\n", name, WTERMSIG(status));
        g_failures++;
        return;
    }
    if(!WIFEXITED(status) || WEXITSTATUS(status) != 0) {
        printf("FAIL %-46s assertion failed\n", name);
        g_failures++;
        return;
    }
    printf("ok   %-46s\n", name);
}

/* ------------------------------------------------------------------ */
/* CVE-2026-66034: publickey comment length bounds                     */
/*                                                                     */
/* A version-1 list entry whose comment length runs past the end of    */
/* the received packet must be rejected with BUFFER_TOO_SMALL. Before  */
/* the correction the length was trusted and the attribute value       */
/* pointer was advanced beyond the packet.                             */
/* ------------------------------------------------------------------ */

static int case_66034_comment_overrun(void)
{
    fixture f;
    unsigned char rx[64];
    unsigned long num = 0;
    libssh2_publickey_list *list = NULL;
    int rc;
    size_t p;

    fixture_init(&f, 1);

    /* Wire format is [packet_len][payload]; the payload begins with the
       response id. A v1 entry whose comment_len runs past the packet must
       be rejected before the attribute value pointer is advanced. */
    p = 4;
    p += put_response_id(rx + p, "publickey");
    put_u32(rx + p, 0xFFFFFFF0u); p += 4;     /* comment_len: overrun */
    memset(rx + p, 0, 8); p += 8;             /* complete the packet */
    put_u32(rx, (uint32_t)(p - 4));

    script_rx(rx, p);
    rc = libssh2_publickey_list_fetch(&f.pkey, &num, &list);

    return expect_error(&f, rc, LIBSSH2_ERROR_BUFFER_TOO_SMALL,
                        "BUFFER_TOO_SMALL");
}

/* ------------------------------------------------------------------ */
/* CVE-2026-58050: publickey attribute count cap                       */
/*                                                                     */
/* A version-2 entry declaring more than 1024 attributes must be       */
/* rejected with OUT_OF_BOUNDARY. Before the correction the count was  */
/* multiplied by the attribute size, which overflows on 32-bit and     */
/* yields a short allocation that the parse loop then overruns.        */
/* ------------------------------------------------------------------ */

static int case_58050_attribute_count_overflow(void)
{
    fixture f;
    unsigned char rx[64];
    unsigned long num = 0;
    libssh2_publickey_list *list = NULL;
    int rc;
    size_t p;

    fixture_init(&f, 2);

    p = 4;
    p += put_response_id(rx + p, "publickey");
    put_u32(rx + p, 0); p += 4;               /* name_len */
    put_u32(rx + p, 0); p += 4;               /* blob_len */
    put_u32(rx + p, 0x40000001u); p += 4;     /* num_attrs: overflow */
    put_u32(rx, (uint32_t)(p - 4));

    script_rx(rx, p);
    rc = libssh2_publickey_list_fetch(&f.pkey, &num, &list);

    return expect_error(&f, rc, LIBSSH2_ERROR_OUT_OF_BOUNDARY,
                        "OUT_OF_BOUNDARY");
}

/* ------------------------------------------------------------------ */
/* CVE-2026-58051: uninitialised list entry on the grow path           */
/*                                                                     */
/* The very first entry forces the initial list allocation and then    */
/* fails partway through. Without the zeroing of the freshly grown     */
/* entry, list[0].packet still holds heap filler and                   */
/* libssh2_publickey_list_free() walks into it. The allocator fills    */
/* fresh bytes with 0xAA so the pre-patch behaviour is a crash rather  */
/* than a silent pass.                                                 */
/* ------------------------------------------------------------------ */

static int case_58051_uninitialised_entry(void)
{
    fixture f;
    unsigned char rx[128];
    unsigned long num = 0;
    libssh2_publickey_list *list = NULL;
    int rc;
    size_t p;

    fixture_init(&f, 2);

    /* One packet: response id, name_len, blob_len, then no num_attrs. */
    p = 4;
    p += put_response_id(rx + p, "publickey");
    put_u32(rx + p, 0); p += 4;               /* name_len */
    put_u32(rx + p, 0); p += 4;               /* blob_len */
    put_u32(rx, (uint32_t)(p - 4));

    script_rx(rx, p);
    rc = libssh2_publickey_list_fetch(&f.pkey, &num, &list);

    return expect_error(&f, rc, LIBSSH2_ERROR_BUFFER_TOO_SMALL,
                        "BUFFER_TOO_SMALL");
}

/* ------------------------------------------------------------------ */
/* CVE-2026-66033: AES-GCM block bounds in _libssh2_cipher_crypt       */
/*                                                                     */
/* The working buffer is EVP_MAX_BLOCK_LENGTH bytes. A block larger    */
/* than that, or smaller than the AAD plus authentication tag, must be */
/* refused before any cipher call. The pre-patch code only asserted,   */
/* which is compiled out in release builds.                            */
/* ------------------------------------------------------------------ */

static int case_66033_aesgcm_bounds(void)
{
    _libssh2_cipher_ctx ctx = NULL;
    unsigned char block[64];
    int rc;

    memset(block, 0, sizeof(block));

    /* larger than the internal working buffer */
    rc = _libssh2_cipher_crypt(&ctx, EVP_aes_128_gcm, 0, block, 33,
                               FIRST_BLOCK | LAST_BLOCK);
    if(rc != 1) {
        printf("     oversized block: expected 1, got %d\n", rc);
        return 1;
    }

    /* smaller than AAD (4) + authentication tag (16) */
    rc = _libssh2_cipher_crypt(&ctx, EVP_aes_128_gcm, 0, block, 19,
                               FIRST_BLOCK | LAST_BLOCK);
    if(rc != 1) {
        printf("     undersized block: expected 1, got %d\n", rc);
        return 1;
    }

    return 0;
}

/* ------------------------------------------------------------------ */
/* CVE-2026-66032: SFTP open dangling pointer on the FXOK path         */
/*                                                                     */
/* A STATUS/FX_OK reply is followed by a malformed HANDLE reply that   */
/* makes the follow-up read fail. The first reply is freed before the  */
/* second is requested; without nulling the pointer the failure path   */
/* frees the stale pointer again.                                      */
/* ------------------------------------------------------------------ */

static int case_66032_sftp_dangling_handle(void)
{
    fixture f;
    LIBSSH2_SFTP sftp;
    unsigned char rx[256];
    LIBSSH2_SFTP_HANDLE *h;
    size_t p = 0;

    fixture_init(&f, 0);
    f.session.socket_state = LIBSSH2_SOCKET_CONNECTED;
    memset(&sftp, 0, sizeof(sftp));
    sftp.channel = &f.channel;
    sftp.request_id = 0;
    sftp.open_state = libssh2_NB_state_idle;
    sftp.packet_state = libssh2_NB_state_idle;

    /* packet 1: STATUS, request id 0, FX_OK */
    put_u32(rx + p, 9); p += 4;
    rx[p++] = SSH_FXP_STATUS;
    put_u32(rx + p, 0); p += 4;
    put_u32(rx + p, LIBSSH2_FX_OK); p += 4;

    /* packet 2: a header whose declared length is below the five-byte
       minimum, so the follow-up read fails instead of returning a
       short HANDLE. */
    put_u32(rx + p, 4); p += 4;
    rx[p++] = SSH_FXP_HANDLE;
    put_u32(rx + p, 0); p += 4;

    script_rx(rx, p);
    h = libssh2_sftp_open_ex(&sftp, "f", 1, 0, 0, LIBSSH2_SFTP_OPENFILE);

    if(h) {
        printf("     expected no handle, got one\n");
        return 1;
    }
    if(f.session.err_code != LIBSSH2_ERROR_SFTP_PROTOCOL) {
        printf("     expected SFTP_PROTOCOL (%d), got %d\n",
               LIBSSH2_ERROR_SFTP_PROTOCOL, f.session.err_code);
        return 1;
    }
    return 0;
}

/* ------------------------------------------------------------------ */
/* CVE-2026-66035: ETM decrypt heap overflow on a short packet         */
/*                                                                     */
/* fullpacket() is static, so the transport source is included here to */
/* reach it directly. A packet whose total length is at least the MAC  */
/* length but smaller than MAC + 4 + blocksize passes the MAC check    */
/* and then yields a decrypt_size smaller than the block that is       */
/* copied into it. The correction rejects the packet before any        */
/* allocation or copy.                                                 */
/* ------------------------------------------------------------------ */

#include "transport.c"

static int fake_mac_hash(LIBSSH2_SESSION *session, unsigned char *buf,
                         uint32_t seqno, const unsigned char *packet,
                         size_t packet_len, const unsigned char *addtl,
                         size_t addtl_len, void **abstract)
{
    (void)session;
    (void)seqno;
    (void)packet;
    (void)packet_len;
    (void)addtl;
    (void)addtl_len;
    (void)abstract;
    memset(buf, 0x5A, 32);
    return 0;
}

static const LIBSSH2_MAC_METHOD fake_mac = {
    "fake-etm", 32, 0, NULL, fake_mac_hash, NULL, 1
};

static int fake_crypt(LIBSSH2_SESSION *session, unsigned int seqno,
                      unsigned char *block, size_t blocksize, void **abstract,
                      int firstlast)
{
    (void)session;
    (void)seqno;
    (void)block;
    (void)blocksize;
    (void)abstract;
    (void)firstlast;
    return 0;
}

static const LIBSSH2_CRYPT_METHOD fake_crypt_method = {
    "fake", NULL, 16, 0, 0, 0, 0, NULL, NULL, fake_crypt, NULL, NULL
};

static int case_66035_etm_short_packet(void)
{
    fixture f;
    unsigned char *payload;
    int rc;

    fixture_init(&f, 0);
    f.session.remote.mac = &fake_mac;
    f.session.remote.crypt = &fake_crypt_method;
    f.session.fullpacket_state = libssh2_NB_state_idle;
    f.session.remote.seqno = 0;

    /* total_num 40 >= mac_len 32, but < mac_len + 4 + blocksize (52) */
    payload = t_alloc(64, NULL);
    if(!payload)
        return 1;
    memset(payload, 0, 64);
    memset(payload + 8, 0x5A, 32);   /* the MAC the fake hash produces */

    f.session.packet.payload = payload;
    f.session.packet.total_num = 40;
    f.session.packet.packet_length = 40;

    rc = fullpacket(&f.session, 1);

    if(rc != LIBSSH2_ERROR_DECRYPT) {
        printf("     expected DECRYPT (%d), got %d\n",
               LIBSSH2_ERROR_DECRYPT, rc);
        return 1;
    }
    return 0;
}

/* ------------------------------------------------------------------ */

int main(void)
{
    printf("libssh2 corrected-seam malformed-input regressions\n");
    run_case("CVE-2026-66034 publickey comment overrun",
             case_66034_comment_overrun);
    run_case("CVE-2026-58050 publickey attribute count overflow",
             case_58050_attribute_count_overflow);
    run_case("CVE-2026-58051 uninitialised list entry",
             case_58051_uninitialised_entry);
    run_case("CVE-2026-66033 AES-GCM block bounds",
             case_66033_aesgcm_bounds);
    run_case("CVE-2026-66032 SFTP open dangling handle",
             case_66032_sftp_dangling_handle);
    run_case("CVE-2026-66035 ETM short packet",
             case_66035_etm_short_packet);

    if(g_failures) {
        printf("%d regression case(s) failed\n", g_failures);
        return 1;
    }
    printf("all regression cases passed\n");
    return 0;
}
