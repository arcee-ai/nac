// Exact-child custody adapter. No policy, configuration, shell or renderer API.
// Node owns this helper; this helper retains the Rust leader until group stop.
#include <errno.h>
#include <fcntl.h>
#include <libproc.h>
#include <sys/proc.h>
#include <poll.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

extern char **environ;
static double now(void) {
    struct timespec value;
    if (clock_gettime(CLOCK_MONOTONIC, &value) != 0) _exit(70);
    return value.tv_sec + value.tv_nsec / 1e9;
}
static int connected(int fd) {
    struct sockaddr_storage address;
    socklen_t length = sizeof(address);
    return getpeername(fd, (struct sockaddr *)&address, &length) == 0 &&
        address.ss_family == AF_UNIX;
}
static int record(const char *kind, pid_t pid) {
    char bytes[128];
    int length = snprintf(bytes, sizeof(bytes), "{\"kind\":\"%s\",\"pid\":%d}\n", kind, pid);
    size_t sent = 0;
    while (sent < (size_t)length) {
        ssize_t count = write(4, bytes + sent, (size_t)length - sent);
        if (count < 0 && errno == EINTR) continue;
        if (count <= 0) return 0;
        sent += (size_t)count;
    }
    return 1;
}
// Terminal facts precede output EOF. Retain the read half until the parent
// acknowledges with EOF: closing with an unread late stop can reset AF_UNIX
// and discard the fact. No control read here can signal an already reaped group.
static int terminal(const char *kind, pid_t pid, int status) {
    int sent = record(kind, pid);
    shutdown(4, SHUT_WR);
    char bytes[64];
    for (;;) {
        ssize_t count = read(4, bytes, sizeof(bytes));
        if (count < 0 && errno == EINTR) continue;
        if (count <= 0) break;
        // Drain only; the one stop has no meaning after terminal settlement.
        // Storage stays bounded even if the peer violates the control contract.
    }
    return sent ? status : 70;
}
// Darwin can return EPERM when the only group members are zombies. Prove
// that exact case while the unreaped leader still reserves the identifier.
static int zombie_group(pid_t leader) {
    pid_t members[4096];
    int bytes = proc_listpids(PROC_PGRP_ONLY, (uint32_t)leader, members, sizeof(members));
    if (bytes <= 0 || bytes >= (int)sizeof(members) || bytes % sizeof(pid_t)) return 0;
    int saw_leader = 0;
    for (int i = 0; i < bytes / (int)sizeof(pid_t); i++) {
        if (members[i] <= 0) continue;
        // waitid(WNOWAIT) already proves this exact retained leader is dead;
        // Darwin proc_pidinfo returns ESRCH for its zombie.
        if (members[i] == leader) { saw_leader = 1; continue; }
        struct proc_bsdinfo info;
        int count = proc_pidinfo(members[i], PROC_PIDTBSDINFO, 0, &info, sizeof(info));
        if (count != sizeof(info)) return 0;
        if (info.pbi_pid != (uint32_t)members[i] || info.pbi_pgid != (uint32_t)leader || info.pbi_status != SZOMB) return 0;
        if (members[i] == leader) saw_leader = 1;
    }
    return saw_leader;
}
int main(int argc, char **argv) {
    if (argc < 2 || argv[1][0] != '/' || !connected(3) || !connected(4)) return 64;
    signal(SIGPIPE, SIG_IGN);
    fcntl(4, F_SETFD, FD_CLOEXEC);
    posix_spawn_file_actions_t actions;
    posix_spawnattr_t attributes;
    if (posix_spawn_file_actions_init(&actions) != 0 ||
        posix_spawnattr_init(&attributes) != 0) return 70;
    posix_spawn_file_actions_adddup2(&actions, 3, 3);
    posix_spawn_file_actions_adddup2(&actions, STDIN_FILENO, STDIN_FILENO);
    posix_spawn_file_actions_adddup2(&actions, STDOUT_FILENO, STDOUT_FILENO);
    posix_spawn_file_actions_adddup2(&actions, STDERR_FILENO, STDERR_FILENO);
    posix_spawn_file_actions_addclose(&actions, 4);
    posix_spawnattr_setflags(&attributes, POSIX_SPAWN_SETPGROUP | POSIX_SPAWN_CLOEXEC_DEFAULT);
    posix_spawnattr_setpgroup(&attributes, 0);
    pid_t engine = 0;
    int launched = posix_spawn(&engine, argv[1], &actions, &attributes, argv + 1, environ);
    posix_spawn_file_actions_destroy(&actions);
    posix_spawnattr_destroy(&attributes);
    // Only Rust retains this endpoint. Actual Node death now closes its peer
    // immediately, independently of this helper's 23-second fallback timer.
    close(3);
    if (launched != 0) return terminal("failed", 0, 70);
    int parent_open = record("spawned", engine);
    double deadline = parent_open ? 0 : now() + 23;
    char control[5]; size_t used = 0;
    for (;;) {
        siginfo_t info = {0};
        if (waitid(P_PID, (id_t)engine, &info, WEXITED | WNOHANG | WNOWAIT) != 0) {
            // Unknown custody is pending forever, never permission to signal.
            if (errno == EINTR) continue;
            for (;;) pause();
        }
        int ended = info.si_pid == engine;
        int expired = deadline > 0 && now() >= deadline;
        if (ended || expired) {
            // The unreaped exact leader reserves this process-group identity.
            // One group signal precedes waitpid; never signal after reaping.
            if (kill(-engine, SIGKILL) != 0 && errno != ESRCH && !(ended && errno == EPERM && zombie_group(engine))) {
                // An orphan zombie may disappear after launchd reaps it. Keep
                // the original unreaped leader and retry inspection; a failed
                // signal is never settlement and Quit cannot create a new stop.
                poll(NULL, 0, 20);
                continue;
            }
            int status;
            while (waitpid(engine, &status, 0) < 0) {
                if (errno != EINTR) for (;;) pause();
            }
            // An engine reap alone is not a descendant-settlement receipt.
            // A remaining/uncertain group keeps the helper alive, without any
            // further signal (the leader no longer reserves its identifier).
            for (;;) {
                if (kill(-engine, 0) != 0 && errno == ESRCH) break;
                struct timespec delay = {0, 20000000}; nanosleep(&delay, NULL);
            }
            return terminal("settled", engine, 0);
        }
        struct pollfd input = { .fd = parent_open ? 4 : -1, .events = POLLIN | POLLHUP };
        int result = poll(&input, 1, 20);
        if (result < 0 && errno != EINTR) parent_open = 0;
        if (result > 0) {
            char bytes[64]; ssize_t count = read(4, bytes, sizeof(bytes));
            if (count <= 0) parent_open = 0;
            else {
                // Exactly one bounded literal control, never a PID or command.
                for (ssize_t i = 0; i < count; i++) {
                    if (used >= sizeof(control) || bytes[i] != "stop\n"[used]) { parent_open = 0; break; }
                    control[used++] = bytes[i];
                }
                if (used == sizeof(control) && deadline == 0) deadline = now() + 23;
            }
        }
        if (!parent_open && deadline == 0) deadline = now() + 23;
    }
}
