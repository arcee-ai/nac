/* Bounded CVE-2026-7598 allocation-order probe; never sends SSH traffic. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "libssh2_priv.h"

static size_t observed_alloc_count;
static size_t observed_alloc_size;

static void *probe_alloc(size_t size, void **opaque)
{
    (void)opaque;
    observed_alloc_count++;
    observed_alloc_size = size;
    /* Stop before the vulnerable tree can copy UINT32_MAX input bytes. */
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

int main(void)
{
    LIBSSH2_SESSION session;
    char tiny_username[] = "x";
    char *methods;

    memset(&session, 0, sizeof(session));
    session.alloc = probe_alloc;
    session.free = probe_free;
    session.realloc = probe_realloc;

    methods = libssh2_userauth_list(&session, tiny_username, UINT32_MAX);
    printf("methods_null=%d error=%d allocations=%zu first_size=%zu\n",
           methods == NULL, session.err_code,
           observed_alloc_count, observed_alloc_size);
    if(methods != NULL)
        return 2;
    if(observed_alloc_count == 0 && session.err_code == LIBSSH2_ERROR_PROTO)
        return 0; /* fixed-side early reject */
    if(observed_alloc_count == 1 && observed_alloc_size == 26 &&
       session.err_code == LIBSSH2_ERROR_ALLOC)
        return 1; /* vulnerable-side wrapped allocation attempt */
    return 3;
}
