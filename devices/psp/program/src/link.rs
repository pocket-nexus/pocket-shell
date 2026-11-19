// SPDX-License-Identifier: GPL-3.0-or-later
//! Pocket Link over the PSPLINK share (the "USB carrier" section of the
//! Pocket Link contract, runtime/spec/link.ts): `globalThis.link` and the
//! media ring on a PSP whose companion serves host0:. The companion beats
//! `host0:/pocket-link/ready`; the console answers with `hello`, and media.rs
//! opens a stream by writing `media.req`. Nothing else rides the share: a UI
//! realm has no network namespace, and the PSP host runs no worker domain.
//!
//! A lower-priority worker owns the beat: it reads `ready` and writes
//! `hello`, so a slow USB round trip never lands in a frame. The QuickJS
//! thread reads the companion's `ready` JSON through a seqlock and performs
//! no host0: read.
//!
//! The link is a host service: bindings.rs starts it when the program
//! installs the namespaces (`frame::Program::globals`) and it survives guest
//! switches. Record layouts and the LinkStatus JSON are in link_record.rs.

use alloc::string::String;
use core::{
    cell::UnsafeCell,
    ffi::c_void,
    sync::atomic::{
        AtomicBool, AtomicU32,
        Ordering::{Acquire, Release},
    },
};

use pocketjs_psp::psp::sys::{self, IoOpenFlags, SceUid};

pub use crate::link_record::{fnv1a32, path};
use crate::link_record::{hello_json, put, status_json, word, HEADER, KIND_HELLO, KIND_MEDIA, KIND_READY, MAGIC, STATUS_MAX};

const BEAT_US: u32 = 500_000;
const SILENCE_US: u32 = 10_000_000;
/// How often a console with no companion reads `ready`.
const UNLINKED_READY_US: u32 = 1_000_000;

/// The beating companion's epoch; 0 while none beats.
static EPOCH: AtomicU32 = AtomicU32::new(0);
/// The companion's `ready` JSON (a seqlock: odd while the worker writes it).
struct Status(UnsafeCell<[u8; STATUS_MAX]>);
unsafe impl Sync for Status {}
static STATUS: Status = Status(UnsafeCell::new([0; STATUS_MAX]));
static STATUS_LEN: AtomicU32 = AtomicU32::new(0);
static STATUS_SEQ: AtomicU32 = AtomicU32::new(0);

// QuickJS-thread state.
static mut STARTED: bool = false;
static mut BOOT: u32 = 0;
static mut DEVICE_ID: [u8; 16] = [b'0'; 16];
/// The `hello` record body the worker writes (built once at start).
static mut HELLO: [u8; 256] = [0; 256];
static mut HELLO_LEN: usize = 0;
/// The worker's first look at `ready` is done (start() waits for it).
static FIRST_READ: AtomicBool = AtomicBool::new(false);

fn now() -> u32 {
    unsafe { sys::sceKernelGetSystemTimeLow() }
}

/// Start the link once per process (it serves every guest); `target` is the
/// profile id the `hello` record names. The call waits for the worker's first
/// look at `ready` (200 ms at most), so a guest that reads `link.status()`
/// or opens a media stream at mount finds a companion already beating.
///
/// # Safety
/// The QuickJS worker thread.
pub unsafe fn start(target: &str) {
    if STARTED {
        return;
    }
    STARTED = true;
    BOOT = now().max(1);
    let mut mac = [0u8; 8];
    if sys::sceWlanGetEtherAddr(mac.as_mut_ptr()) >= 0 {
        let hex = b"0123456789abcdef";
        for (i, b) in mac[..6].iter().enumerate() {
            DEVICE_ID[4 + i * 2] = hex[(b >> 4) as usize];
            DEVICE_ID[5 + i * 2] = hex[(b & 0xf) as usize];
        }
    }
    let id = core::str::from_utf8(&DEVICE_ID).unwrap_or("0000000000000000");
    let hello = hello_json(id, target);
    let len = hello.len().min(HELLO.len());
    HELLO[..len].copy_from_slice(&hello.as_bytes()[..len]);
    HELLO_LEN = len;
    let th = sys::sceKernelCreateThread(
        b"pocket-link\0".as_ptr(),
        worker,
        0x30,
        16384,
        sys::ThreadAttributes::USER,
        core::ptr::null_mut(),
    );
    if th.0 >= 0 {
        sys::sceKernelStartThread(th, 0, core::ptr::null_mut());
        // A companion already beating is linked before the first guest runs.
        // The worker reads `ready`, so a hung usbhostfs holds the boot for
        // this wait (200 ms) and no longer.
        for _ in 0..100 {
            if FIRST_READ.load(Acquire) {
                break;
            }
            sys::sceKernelDelayThread(2_000);
        }
    }
}

/// spec link op status(): a LinkStatus JSON for the share's companion.
///
/// # Safety
/// The QuickJS worker thread.
pub unsafe fn link_status() -> String {
    let mut status = [0u8; STATUS_MAX];
    let mut len;
    loop {
        let before = STATUS_SEQ.load(Acquire);
        len = STATUS_LEN.load(Acquire) as usize;
        if before & 1 == 0 {
            let shared = &*STATUS.0.get();
            status[..len].copy_from_slice(&shared[..len]);
            if STATUS_SEQ.load(Acquire) == before {
                break;
            }
        }
        sys::sceKernelDelayThread(100);
    }
    let device = core::str::from_utf8(&DEVICE_ID).unwrap_or("");
    status_json(&status[..len], EPOCH.load(Acquire) != 0, device)
}

// ---- the worker ------------------------------------------------------------------

unsafe fn open(path: &[u8], write: bool) -> SceUid {
    sys::sceIoOpen(
        path.as_ptr(),
        if write {
            IoOpenFlags::WR_ONLY | IoOpenFlags::CREAT | IoOpenFlags::TRUNC
        } else {
            IoOpenFlags::RD_ONLY
        },
        0o666,
    )
}

/// Read `len` bytes into `into`, 32 KiB at a time: the size usbhostfs moves
/// whole (one 64 KiB read lost a media stream after its header).
///
/// # Safety
/// `into` holds `len` writable bytes.
pub unsafe fn read_all(fd: SceUid, into: *mut u8, len: usize) -> bool {
    let mut n = 0;
    while n < len {
        let k = sys::sceIoRead(fd, into.add(n) as *mut c_void, (len - n).min(32768) as u32);
        if k <= 0 {
            return false;
        }
        n += k as usize;
    }
    true
}

unsafe fn write_all(fd: SceUid, from: *const u8, len: usize) -> bool {
    let mut n = 0;
    while n < len {
        let k = sys::sceIoWrite(fd, from.add(n) as *const c_void, (len - n).min(32768));
        if k <= 0 {
            return false;
        }
        n += k as usize;
    }
    true
}

/// Write the record of `json`: hello and media records.
unsafe fn write_record(file: &[u8], epoch: u32, seq: u32, kind: u32, beat: u32, json: &[u8]) -> bool {
    let mut head = [0u8; HEADER];
    for (at, value) in [
        (0, MAGIC),
        (4, epoch),
        (8, BOOT),
        (12, seq),
        (16, kind),
        (24, beat),
        (32, json.len() as u32),
        (36, fnv1a32(json)),
    ] {
        put(&mut head, at, value);
    }
    let fd = open(file, true);
    if fd.0 < 0 {
        return false;
    }
    let ok = write_all(fd, head.as_ptr(), HEADER) && write_all(fd, json.as_ptr(), json.len());
    sys::sceIoClose(fd);
    ok
}

/// The beating companion's epoch, 0 while none beats (any thread).
pub fn epoch() -> u32 {
    EPOCH.load(Acquire)
}

/// Write `media.req` (the USB carrier's "Media" section) for stream
/// `generation`: open the ticket `token` names, or close with None. Any
/// thread; false with no companion or when the write fails.
///
/// # Safety
/// After start().
pub unsafe fn media_request(generation: u32, token: Option<&[u8; 64]>) -> bool {
    let epoch = EPOCH.load(Acquire);
    if epoch == 0 {
        return false;
    }
    let mut json = [0u8; 96];
    let open = b"{\"t\":\"media\"";
    json[..open.len()].copy_from_slice(open);
    let mut len = open.len();
    if let Some(token) = token {
        let key = b",\"token\":\"";
        json[len..len + key.len()].copy_from_slice(key);
        len += key.len();
        json[len..len + 64].copy_from_slice(token);
        len += 64;
        json[len] = b'"';
        len += 1;
    }
    json[len] = b'}';
    len += 1;
    write_record(&path(b"media.req"), epoch, generation, KIND_MEDIA, 0, &json[..len])
}

/// The companion's `ready` record into `status`: (epoch, beat, json length).
unsafe fn read_ready(status: &mut [u8; STATUS_MAX]) -> Option<(u32, u32, usize)> {
    let fd = open(&path(b"ready"), false);
    if fd.0 < 0 {
        return None;
    }
    let mut head = [0u8; HEADER];
    let mut out = None;
    if read_all(fd, head.as_mut_ptr(), HEADER) && word(&head, 0) == MAGIC && word(&head, 16) == KIND_READY {
        let len = word(&head, 32) as usize;
        if word(&head, 4) != 0 && len <= STATUS_MAX && read_all(fd, status.as_mut_ptr(), len) && fnv1a32(&status[..len]) == word(&head, 36) {
            out = Some((word(&head, 4), word(&head, 24), len));
        }
    }
    sys::sceIoClose(fd);
    out
}

unsafe fn publish_status(json: &[u8]) {
    STATUS_SEQ.fetch_add(1, Release);
    let shared = &mut *STATUS.0.get();
    shared[..json.len()].copy_from_slice(json);
    STATUS_LEN.store(json.len() as u32, Release);
    STATUS_SEQ.fetch_add(1, Release);
}

unsafe extern "C" fn worker(_: usize, _: *mut c_void) -> i32 {
    let mut status = [0u8; STATUS_MAX];
    let mut epoch = 0u32;
    let mut beat = 0u32;
    let mut beat_at = now();
    // The epoch and beat a companion went silent on: the same `ready` read
    // again is a file it left behind (a crash or an OOM kill), not a companion.
    let mut silent = (0u32, 0u32);
    let mut ready_at = now().wrapping_sub(UNLINKED_READY_US);
    let mut hello_at = 0u32;
    let mut hello_beat = 0u32;
    let mut hello_due = false;
    loop {
        let t = now();
        // A linked console looks at the beat five times a beat; one with no
        // companion looks once a second.
        let cadence = if epoch != 0 { BEAT_US / 5 } else { UNLINKED_READY_US };
        if t.wrapping_sub(ready_at) >= cadence {
            ready_at = t;
            match read_ready(&mut status) {
                Some((e, b, len)) if (e, b) != silent => {
                    silent = (0, 0);
                    if e != epoch {
                        epoch = e;
                        EPOCH.store(0, Release);
                        beat_at = t;
                        hello_due = true;
                        publish_status(&status[..len]);
                        EPOCH.store(epoch, Release);
                    }
                    if b != beat {
                        beat = b;
                        beat_at = t;
                        publish_status(&status[..len]);
                    }
                }
                _ => {}
            }
            FIRST_READ.store(true, Release);
            if epoch != 0 && t.wrapping_sub(beat_at) > SILENCE_US {
                silent = (epoch, beat);
                epoch = 0;
                EPOCH.store(0, Release);
            }
        }
        if epoch != 0 && (hello_due || t.wrapping_sub(hello_at) >= 2 * BEAT_US) {
            hello_beat = hello_beat.wrapping_add(1);
            if write_record(&path(b"hello"), epoch, 0, KIND_HELLO, hello_beat, &HELLO[..HELLO_LEN]) {
                hello_due = false;
                hello_at = t;
            }
        }
        // The next thing to do is the next look at `ready`.
        sys::sceKernelDelayThread(BEAT_US / 5);
    }
}
