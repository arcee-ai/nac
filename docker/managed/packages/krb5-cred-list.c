#include "lib/krb5/krb/rd_cred.c"

krb5_error_code k5_privsafe_check_replay(krb5_context context,
    krb5_auth_context authcon, const krb5_replay_data *rdata,
    const krb5_enc_data *enc, const krb5_checksum *cksum)
{
    (void)context;
    (void)authcon;
    (void)rdata;
    (void)enc;
    (void)cksum;
    abort(); /* This regression calls only make_cred_list(). */
}

int main(void)
{
    krb5_context context = NULL;
    krb5_ticket ticket = {0};
    krb5_ticket *tickets[] = {&ticket, NULL};
    krb5_cred cred = {0};
    krb5_cred_info *infos[] = {NULL};
    krb5_cred_enc_part part = {0};
    krb5_creds **output = NULL;
    krb5_error_code ret;

    cred.tickets = tickets;
    part.ticket_info = infos;
    if (krb5_init_context(&context) != 0)
        return 2;
    ret = make_cred_list(context, &cred, &part, &output);
    if (output != NULL || ret != KRB5KRB_AP_ERR_MODIFIED)
        return 1;
    krb5_free_context(context);
    return 0;
}
