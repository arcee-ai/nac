#include <sys/mman.h>
#include <unistd.h>
#include "lib/gssapi/mechglue/mglueP.h"
#include "lib/gssapi/spnego/negoex_util.c"

int main(void)
{
    OM_uint32 minor = 0, major;
    struct k5input in;
    struct spnego_ctx_st ctx = {0};
    struct negoex_message msg = {0};
    size_t page = (size_t)sysconf(_SC_PAGESIZE);
    uint8_t *mapping = mmap(NULL, page * 2, PROT_READ | PROT_WRITE,
                            MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    uint8_t *bytes;

    if (mapping == MAP_FAILED || mprotect(mapping + page, page, PROT_NONE) != 0)
        return 2;
    bytes = mapping + page - 40;
    memset(bytes, 0, 40);
    store_64_le(MESSAGE_SIGNATURE, bytes);
    store_32_le(INITIATOR_NEGO, bytes + 8);
    /* Header length is shorter than the 40-byte common header. */
    store_32_le(0, bytes + 16);
    store_32_le(40, bytes + 20);
    k5_input_init(&in, bytes, 40);
    major = parse_message(&minor, &ctx, &in, bytes, &msg);
    if (major != GSS_S_DEFECTIVE_TOKEN || minor != ERR_NEGOEX_INVALID_MESSAGE_SIZE)
        return 1;
    munmap(mapping, page * 2);
    return 0;
}
