/**
 * First run: give a fresh install one project for the server's launch folder,
 * so a new user can start a chat without creating a project first. Runs once;
 * an install that already has projects is marked done, so deleting every
 * project later does not bring the default back.
 *
 * TODO(backend): seed this at server first start from the folder `nac-web`
 * confirms (`-C`/the startup prompt), and record that it ran in the store
 * instead of this browser's local storage. Managed hosts keep their
 * repository flow and are never seeded.
 *
 * Returns true while the default is being decided or created, so Home can
 * show its loading state instead of flashing the empty state.
 */
export declare function useDefaultProject(): boolean;
