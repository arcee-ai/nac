// Private presentation checkpoint adapter. No renderer paths or operations enter
// this process. Keep the lease through stdin EOF and all preceding replacements.
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>

#define LIMIT (8U * 1024U * 1024U)
static int transfer(int fd, void *buffer, size_t length, int writing) {
    unsigned char *bytes = buffer;
    while (length) {
        ssize_t count = writing ? write(fd, bytes, length) : read(fd, bytes, length);
        if (count < 0 && errno == EINTR) continue;
        if (count <= 0) return -1;
        bytes += count;
        length -= (size_t)count;
    }
    return 0;
}
static int reply(unsigned char status, void *data, uint32_t length) {
    uint32_t size = htonl(length);
    return transfer(1, &status, 1, 1) || transfer(1, &size, 4, 1) ||
           (length && transfer(1, data, length, 1));
}
static int regular(int fd) {
    struct stat status;
    return fstat(fd, &status) == 0 && S_ISREG(status.st_mode) &&
           status.st_uid == getuid() && !(status.st_mode & 0077) && status.st_nlink == 1;
}
static int directory(const char *home, const char *track, const char *profile, int *lease) {
    int current = open(home, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
    const char *parts[] = {"Library", "Application Support", "NAC", "Presentation", track, profile};
    if (current < 0) return -1;
    for (size_t i = 0; i < sizeof(parts) / sizeof(parts[0]); i++) {
        if (mkdirat(current, parts[i], 0700) && errno != EEXIST) goto fail;
        int next = openat(current, parts[i], O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
        struct stat status;
        if (next < 0) goto fail;
        if (fstat(next, &status) || status.st_uid != getuid() ||
            (status.st_mode & (i < 2 ? 0022 : 0077))) { close(next); goto fail; }
        close(current);
        current = next;
    }
    *lease = openat(current, ".checkpoint.lock", O_RDWR | O_CREAT | O_CLOEXEC | O_NOFOLLOW, 0600);
    if (*lease < 0 || !regular(*lease) || flock(*lease, LOCK_EX | LOCK_NB)) goto fail;
    return current;
fail:
    if (*lease >= 0) close(*lease);
    close(current);
    return -1;
}
static int load(int directory) {
    int fd = openat(directory, "checkpoint.json", O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
    if (fd < 0) return errno == ENOENT ? reply(0, NULL, 0) : -1;
    struct stat status;
    if (!regular(fd) || fstat(fd, &status) || status.st_size < 0 || status.st_size > LIMIT) {
        close(fd); return -1;
    }
    uint32_t length = (uint32_t)status.st_size;
    void *bytes = malloc(length ? length : 1);
    int result = !bytes || transfer(fd, bytes, length, 0) || reply(0, bytes, length);
    free(bytes); close(fd);
    return result;
}
// A first Swift-compatible import keeps its original versioned bytes even if
// the parent dies after rename but before receiving the exact write ACK. This
// recovery source is never automatically hydrated or deleted by a later run.
static int retain_source(int directory, char *retained, size_t capacity) {
    int source = openat(directory, "checkpoint.json", O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
    if (source < 0) return errno == ENOENT ? 0 : -1;
    if (!regular(source)) { close(source); return -1; }
    unsigned char random[16];
    arc4random_buf(random, sizeof(random));
    char suffix[33];
    for (size_t i = 0; i < sizeof(random); i++) snprintf(suffix + i * 2, 3, "%02x", random[i]);
    snprintf(retained, capacity, "migration-v1-source-%s.json", suffix);
    int target = openat(directory, retained, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0600);
    if (target < 0) { close(source); return -1; }
    char bytes[16384];
    size_t total = 0;
    int result = 0;
    for (;;) {
        ssize_t count = read(source, bytes, sizeof(bytes));
        if (count < 0 && errno == EINTR) continue;
        if (count < 0) { result = -1; break; }
        if (!count) break;
        total += (size_t)count;
        if (total > LIMIT) { result = -1; break; }
        if (transfer(target, bytes, (size_t)count, 1)) { result = -1; break; }
    }
    if (fsync(target) || fsync(directory)) result = -1;
    close(source); close(target);
    if (result) { unlinkat(directory, retained, 0); retained[0] = 0; }
    return result;
}
static int replace(int directory, void *bytes, uint32_t length, unsigned revision) {
    char temporary[80];
    snprintf(temporary, sizeof(temporary), ".checkpoint-%ld-%u", (long)getpid(), revision);
    int fd = openat(directory, temporary, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0600);
    if (fd < 0) return -1;
    int result = transfer(fd, bytes, length, 1) || fsync(fd) ||
                 renameat(directory, temporary, directory, "checkpoint.json") || fsync(directory);
    close(fd);
    if (unlinkat(directory, temporary, 0) && errno != ENOENT) result = -1;
    // A failed replacement never unlinks the prior source. Failure cannot ACK a
    // durable clear, even when rename succeeded and the directory sync failed.
    return result;
}
int main(int argc, char **argv) {
    signal(SIGPIPE, SIG_IGN);
    if (argc != 4 || argv[1][0] != '/' ||
        (strcmp(argv[2], "dev") && strcmp(argv[2], "beta") && strcmp(argv[2], "stable"))) return 2;
    if (strlen(argv[3]) != 64 || strspn(argv[3], "0123456789abcdef") != 64) return 2;
    int lease = -1;
    int owner = directory(argv[1], argv[2], argv[3], &lease);
    if (owner < 0 || load(owner)) { reply(1, NULL, 0); return 1; }
    unsigned revision = 0;
    char retained[100] = {0};
    int awaiting_ack = 0;
    for (;;) {
        uint32_t size;
        // EOF acknowledges no operation; already accepted writes precede EOF.
        if (transfer(0, &size, 4, 0)) break;
        uint32_t length = ntohl(size);
        if (!length) {
            if (!awaiting_ack) break;
            int failed = retained[0] && (unlinkat(owner, retained, 0) || fsync(owner));
            if (reply(failed ? 1 : 0, NULL, 0) || failed) break;
            retained[0] = 0; awaiting_ack = 0;
            continue;
        }
        if (awaiting_ack || length > LIMIT || revision == UINT32_MAX) break;
        void *bytes = malloc(length);
        if (!bytes || transfer(0, bytes, length, 0)) { free(bytes); break; }
        int failed = (!revision && retain_source(owner, retained, sizeof(retained))) || replace(owner, bytes, length, ++revision);
        free(bytes);
        if (reply(failed ? 1 : 0, NULL, 0) || failed) break;
        awaiting_ack = 1;
    }
    close(lease); close(owner);
    return 0;
}
