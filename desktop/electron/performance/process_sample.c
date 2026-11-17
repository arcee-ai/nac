// Read-only macOS counters. No process control, task ports or elevated rights.
#include <errno.h>
#include <libproc.h>
#include <mach/mach_time.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/resource.h>

int main(int argc, char **argv) {
    mach_timebase_info_data_t timebase;
    if (mach_timebase_info(&timebase) != KERN_SUCCESS || !timebase.denom) return 70;
    printf("[");
    for (int i = 1; i < argc; i++) {
        char *end = NULL;
        long value = strtol(argv[i], &end, 10);
        if (!end || *end || value <= 0 || value > 2147483647) return 64;
        pid_t pid = (pid_t)value;
        struct rusage_info_v0 usage = {0};
        struct proc_bsdinfo before = {0}, after = {0};
        int first = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &before, sizeof before);
        int sampled = proc_pid_rusage(pid, RUSAGE_INFO_V0, (rusage_info_t *)&usage);
        int last = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &after, sizeof after);
        int valid = first == sizeof before && last == sizeof after && !sampled &&
            before.pbi_pid == (uint32_t)pid && after.pbi_pid == (uint32_t)pid &&
            before.pbi_start_tvsec == after.pbi_start_tvsec &&
            before.pbi_start_tvusec == after.pbi_start_tvusec;
        if (i > 1) printf(",");
        printf("{\"pid\":%d,\"valid\":%s", pid, valid ? "true" : "false");
        if (valid) {
            printf(",\"birth_sec\":%llu,\"birth_usec\":%llu,\"ppid\":%u,"
                   "\"cpu_ns\":%llu,\"physical_footprint_bytes\":%llu,"
                   "\"resident_bytes\":%llu,\"package_idle_wakeups\":%llu,"
                   "\"interrupt_wakeups\":%llu",
                   before.pbi_start_tvsec, before.pbi_start_tvusec, before.pbi_ppid,
                   (uint64_t)(((__uint128_t)usage.ri_user_time + usage.ri_system_time) *
                              timebase.numer / timebase.denom), usage.ri_phys_footprint,
                   usage.ri_resident_size, usage.ri_pkg_idle_wkups, usage.ri_interrupt_wkups);
        }
        printf("}");
    }
    printf("]\n");
    return 0;
}
