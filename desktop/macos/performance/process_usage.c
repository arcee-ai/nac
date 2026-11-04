/* Read-only, one-PID calibration probe. No process discovery or signaling. */
#include <errno.h>
#include <inttypes.h>
#include <libproc.h>
#include <mach/mach_time.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/proc_info.h>
#include <sys/resource.h>
#include <unistd.h>

static bool number(const char *text, uint64_t *value) {
    if (!text[0] || text[0] == '-' || text[0] == '+') return false;
    for (const char *p = text; *p; p++) if (*p < '0' || *p > '9') return false;
    char *end = NULL;
    errno = 0;
    *value = strtoull(text, &end, 10);
    return errno == 0 && end && *end == 0;
}

static void string(const char *value) {
    putchar('"');
    for (const unsigned char *p = (const unsigned char *)value; *p; p++) {
        if (*p == '"' || *p == '\\') printf("\\%c", *p);
        else if (*p < 32 || *p >= 127) printf("\\u%04x", *p);
        else putchar(*p);
    }
    putchar('"');
}

static int unavailable(int pid, int error, const char *reason) {
    printf("{\"schema\":\"nac-mac-process-v1\",\"pid\":%d,", pid);
    printf("\"status\":\"unavailable\",\"reason\":"); string(reason);
    printf(",\"errno\":%d,\"identity\":null,\"cpu_user_raw\":null,"
           "\"cpu_system_raw\":null,\"resident_bytes\":null,"
           "\"physical_footprint_bytes\":null,\"package_idle_wakeups\":null,"
           "\"interrupt_wakeups\":null}\n", error);
    return 2;
}

int main(int argc, char **argv) {
    uint64_t pid_value = 0, expected_start = 0;
    if ((argc != 3 && argc != 5) || strcmp(argv[1], "--pid") ||
        !number(argv[2], &pid_value) || pid_value == 0 || pid_value > INT32_MAX ||
        (argc == 5 && (strcmp(argv[3], "--expect-start") || !number(argv[4], &expected_start)))) {
        fputs("usage: process_usage --pid POSITIVE_PID [--expect-start MACH_START]\n", stderr);
        return 64;
    }
    int pid = (int)pid_value;
    struct proc_bsdinfo before = {0}, after = {0};
    struct rusage_info_v0 usage = {0}, end = {0};
    mach_timebase_info_data_t scale;
    char path[PROC_PIDPATHINFO_MAXSIZE] = {0};
    uint64_t observed = mach_absolute_time();
    if (mach_timebase_info(&scale) != KERN_SUCCESS || scale.denom == 0)
        return unavailable(pid, 0, "mach_timebase_unavailable");
    if (proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &before, sizeof(before)) != sizeof(before))
        return unavailable(pid, errno, "identity_before_unavailable");
    if (before.pbi_uid != getuid())
        return unavailable(pid, 0, "different_user_not_sampled");
    if (proc_pid_rusage(pid, RUSAGE_INFO_V0, (rusage_info_t *)&usage) != 0)
        return unavailable(pid, errno, "rusage_unavailable");
    if (proc_pidpath(pid, path, sizeof(path)) <= 0)
        return unavailable(pid, errno, "executable_binding_unavailable");
    if (proc_pid_rusage(pid, RUSAGE_INFO_V0, (rusage_info_t *)&end) != 0 ||
        proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &after, sizeof(after)) != sizeof(after))
        return unavailable(pid, errno, "identity_after_unavailable");
    if (before.pbi_pid != (uint32_t)pid || after.pbi_pid != (uint32_t)pid ||
        before.pbi_start_tvsec != after.pbi_start_tvsec ||
        before.pbi_start_tvusec != after.pbi_start_tvusec ||
        usage.ri_proc_start_abstime == 0 || usage.ri_proc_start_abstime != end.ri_proc_start_abstime ||
        (argc == 5 && expected_start != usage.ri_proc_start_abstime))
        return unavailable(pid, 0, "process_incarnation_changed_or_unknown");
    printf("{\"schema\":\"nac-mac-process-v1\",\"status\":\"observed\",\"pid\":%d,", pid);
    printf("\"ppid\":%u,\"uid\":%u,\"executable\":", before.pbi_ppid, before.pbi_uid);
    string(path);
    printf(",\"identity\":{\"start_mach_ticks\":\"%" PRIu64 "\","
           "\"start_wall_seconds\":\"%" PRIu64 "\",\"start_wall_microseconds\":\"%" PRIu64 "\"},",
           usage.ri_proc_start_abstime, before.pbi_start_tvsec, before.pbi_start_tvusec);
    printf("\"observed_mach_ticks\":\"%" PRIu64 "\",\"timebase_numer\":%u,\"timebase_denom\":%u,",
           observed, scale.numer, scale.denom);
    /* Preserve raw counters. The allocated runtime must validate their clock
       semantics before deriving CPU percentages; do not relabel them as ns. */
    printf("\"cpu_user_raw\":\"%" PRIu64 "\",\"cpu_system_raw\":\"%" PRIu64 "\","
           "\"cpu_unit\":\"rusage_v0_raw_requires_calibration\","
           "\"resident_bytes\":\"%" PRIu64 "\",\"physical_footprint_bytes\":\"%" PRIu64 "\","
           "\"package_idle_wakeups\":\"%" PRIu64 "\",\"interrupt_wakeups\":\"%" PRIu64 "\","
           "\"energy_joules\":null,\"attribution_complete\":false}\n",
           usage.ri_user_time, usage.ri_system_time, usage.ri_resident_size,
           usage.ri_phys_footprint, usage.ri_pkg_idle_wkups, usage.ri_interrupt_wkups);
    return 0;
}
