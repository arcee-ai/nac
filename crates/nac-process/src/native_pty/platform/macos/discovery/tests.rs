use super::super::inspection::Short;
use super::super::Unique;
use super::*;
use std::cell::{Cell, RefCell};

struct Fake {
    sid: Cell<libc::pid_t>,
    unique: Cell<u64>,
    parent: Cell<u64>,
    ppid: Cell<libc::pid_t>,
    status: Cell<u32>,
    denied: Cell<bool>,
    sid_denied: Cell<bool>,
    gone: Cell<bool>,
    identities: RefCell<Vec<u64>>,
    sessions: RefCell<Vec<libc::pid_t>>,
    versions: RefCell<Vec<i32>>,
}
impl Fake {
    fn new(sid: libc::pid_t) -> Self {
        Self {
            sid: Cell::new(sid),
            unique: Cell::new(7),
            parent: Cell::new(9),
            ppid: Cell::new(50),
            status: Cell::new(3),
            denied: Cell::new(false),
            sid_denied: Cell::new(false),
            gone: Cell::new(false),
            identities: RefCell::new(Vec::new()),
            sessions: RefCell::new(Vec::new()),
            versions: RefCell::new(Vec::new()),
        }
    }
}
fn next<T: Copy>(queue: &RefCell<Vec<T>>, fallback: T) -> T {
    if queue.borrow().is_empty() {
        fallback
    } else {
        queue.borrow_mut().remove(0)
    }
}
impl Probe for Fake {
    fn unique(&self, _: libc::pid_t) -> io::Result<Option<Unique>> {
        if self.gone.get() {
            return Ok(None);
        }
        if self.denied.get() {
            return Err(io::Error::from_raw_os_error(libc::EPERM));
        }
        Ok(Some(Unique {
            uniqueid: next(&self.identities, self.unique.get()),
            version: next(&self.versions, 1),
            parent_uniqueid: self.parent.get(),
            ..Unique::default()
        }))
    }
    fn short(&self, pid: libc::pid_t) -> io::Result<Option<Short>> {
        if self.gone.get() {
            return Ok(None);
        }
        if self.denied.get() {
            return Err(io::Error::from_raw_os_error(libc::EPERM));
        }
        Ok(Some(Short {
            pid,
            ppid: self.ppid.get(),
            status: self.status.get(),
        }))
    }
    fn sid(&self, _: libc::pid_t) -> io::Result<Option<libc::pid_t>> {
        if self.sid_denied.get() {
            return Err(io::Error::from_raw_os_error(libc::EPERM));
        }
        Ok((!self.gone.get()).then(|| next(&self.sessions, self.sid.get())))
    }
}
fn scan(discovery: &mut Discovery, fake: &Fake) -> Census {
    discovery
        .scan(100, &HashMap::new(), vec![200], fake)
        .unwrap()
}

#[test]
fn inaccessible_unrelated_session_does_not_poison_or_acquire_authority() {
    let fake = Fake::new(900);
    fake.denied.set(true);
    let mut discovery = Discovery::default();
    let census = scan(&mut discovery, &fake);
    assert!(census.error.is_none());
    assert!(discovery.pending.is_empty());
    assert!(census.identities.is_empty());
    assert!(census.rows.is_empty());
}
#[test]
fn denied_owned_sid_is_retained_before_identity_and_only_positive_death_settles() {
    let fake = Fake::new(100);
    fake.denied.set(true);
    let mut discovery = Discovery::default();
    assert!(scan(&mut discovery, &fake).error.is_some());
    assert!(discovery.pending[&200].owned);
    assert!(discovery.pending[&200].uniqueid.is_none());
    fake.denied.set(false);
    fake.sid.set(900);
    let census = scan(&mut discovery, &fake);
    assert!(census.error.is_some());
    assert!(census.identities.is_empty());
    assert!(discovery.pending.contains_key(&200));
    fake.gone.set(true);
    let census = discovery
        .scan(100, &HashMap::new(), Vec::new(), &fake)
        .unwrap();
    assert!(census.error.is_none());
    assert!(discovery.pending.is_empty());
}
#[test]
fn unknown_sid_obligation_cannot_be_forgotten_or_become_raw_pid_authority() {
    let fake = Fake::new(900);
    fake.sid_denied.set(true);
    let mut discovery = Discovery::default();
    assert!(scan(&mut discovery, &fake).error.is_some());
    assert!(!discovery.pending[&200].owned);
    assert_eq!(discovery.pending[&200].uniqueid, Some(7));
    fake.sid_denied.set(false);
    let census = scan(&mut discovery, &fake);
    assert!(census.error.is_some());
    assert!(census.identities.is_empty());
    fake.unique.set(8); // Positive original identity replacement, not permission recovery.
    let census = scan(&mut discovery, &fake);
    assert!(census.error.is_none());
    assert!(discovery.pending.is_empty());
    assert!(census.identities.is_empty());
}
#[test]
fn exact_owned_unknown_state_survives_uid_or_session_change_and_retry() {
    let fake = Fake::new(100);
    fake.status.set(9);
    let mut discovery = Discovery::default();
    assert!(scan(&mut discovery, &fake).error.is_some());
    assert_eq!(discovery.pending[&200].uniqueid, Some(7));
    fake.sid.set(900);
    fake.status.set(3);
    let census = scan(&mut discovery, &fake);
    assert!(census.error.is_none());
    assert_eq!(census.identities.len(), 1);
    assert_eq!(census.identities[0].0, (200, 7));
    assert!(discovery.pending.is_empty());
}
#[test]
fn parent_binding_uses_retained_exact_birth_identity_not_numeric_pid() {
    let fake = Fake::new(900);
    fake.ppid.set(50);
    fake.status.set(9);
    let mut known = HashMap::new();
    known.insert(
        (50, 9),
        Arc::new(Identity {
            pid: 50,
            uniqueid: 9,
        }),
    );
    let mut discovery = Discovery::default();
    assert!(discovery
        .scan(100, &known, vec![200], &fake)
        .unwrap()
        .error
        .is_some());
    assert_eq!(discovery.pending[&200].uniqueid, Some(7));
    fake.parent.set(10);
    let mut unrelated = Discovery::default();
    assert!(unrelated
        .scan(100, &known, vec![200], &fake)
        .unwrap()
        .error
        .is_none());
    assert!(unrelated.pending.is_empty());
}
#[test]
fn identity_exec_and_sid_bookends_never_mix_process_records() {
    for mode in 0..3 {
        let fake = Fake::new(100);
        match mode {
            0 => *fake.identities.borrow_mut() = vec![7, 8, 7, 8, 7, 8],
            1 => *fake.versions.borrow_mut() = vec![1, 2, 1, 2, 1, 2],
            _ => *fake.sessions.borrow_mut() = vec![100, 900, 100, 900, 100, 900],
        }
        assert_eq!(
            snapshot(200, &fake).err().unwrap().kind(),
            io::ErrorKind::WouldBlock
        );
    }
}
