// Deterministic uncooperative engine: one ordinary descendant in its owned group.
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
int main(void) {
    pid_t child = fork();
    if (child < 0) return 70;
    if (child == 0) for (;;) pause();
    printf("%d\n", child); fflush(stdout);
    for (;;) pause();
}
