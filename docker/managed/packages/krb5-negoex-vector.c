#include "lib/gssapi/mechglue/mglueP.h"
#include "lib/gssapi/spnego/negoex_util.c"

int main(void)
{
    OM_uint32 minor = 0, major;
    struct k5input in;
    struct nego_message msg = {0};
    uint8_t bytes[128] = {0};
    size_t length = sizeof(msg.random) + 8 + 4 + 2 + 4 + 2;
    size_t extension_offset = sizeof(msg.random) + 8 + 4 + 2;

    /* Zero schemes; an extension vector outside this bounded message. */
    bytes[extension_offset] = 0xff;
    bytes[extension_offset + 1] = 0xff;
    bytes[extension_offset + 4] = 1;
    k5_input_init(&in, bytes, length);
    major = parse_nego_message(&minor, &in, bytes, length, &msg);
    if (major != GSS_S_DEFECTIVE_TOKEN || minor != ERR_NEGOEX_INVALID_MESSAGE_SIZE)
        return 1;
    return 0;
}
