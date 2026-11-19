// SPDX-License-Identifier: GPL-3.0-or-later
#![no_std]
#![no_main]
#![allow(static_mut_refs)]

//! Pocket Shell's PSP program. App 0 (the launcher) is the bundle the
//! pocketjs-psp library embeds; build.rs embeds the applets after it. One
//! guest runs at a time through the library's frame loop (`frame::run`);
//! between two guests the program plays the veil, then boots the next one.
//! A table of one runs that application alone.
//!
//! Every guest gets `globalThis.link` and `globalThis.media` over the
//! companion's USB carrier on `host0:` (bindings.rs, link.rs, media.rs).
//! The program owns that share, so the library leaves the DevTools mailbox
//! unprobed (`Options::devtools`).

extern crate alloc;

mod bindings;
mod link;
mod link_record;
mod media;
mod media_wire;
mod switch;
mod veil;

use pocketjs_psp::{frame, Options};

pocketjs_psp::module!("pocket-shell", run);

// The full launcher consumed about 42 ms of CPU work on real PSP hardware.
// Batching cuts that to about 12 ms, but the texture-heavy GE pass still
// completes across the third vblank. A multi-app image therefore presents at
// 20 Hz and advances the package rate divided by 20 core ticks per frame, so
// switching guests never changes the meaning of a frame or of a captured
// input tape. A table of one presents at the cadence the runtime selects.
const MULTI_APP_SIM_HZ: u32 = 20;

fn run() {
    let cadence = switch::multi().then_some(MULTI_APP_SIM_HZ);
    let mut index = 0usize;
    loop {
        index = unsafe { run_guest(index, cadence) };
        frame::trace("run: guest swap");
        unsafe { veil::play() };
    }
}

/// Boot app `index`, drive it until a switch request, and return the app to
/// boot next.
unsafe fn run_guest(index: usize, cadence: Option<u32>) -> usize {
    switch::set_current(index);
    let source = match switch::guest_source(index) {
        Ok(source) => source,
        Err(error) => return guest_fail(index, &error),
    };
    // Two guests never share a save directory: each takes its output name.
    let options = Options {
        cadence,
        data_name: Some(alloc::string::String::from(switch::app(index).output)),
        devtools: false,
    };
    let ran = frame::run(source, options, &mut switch::Guest::new(index));
    // The guest's runtime is gone: its media stream stops and its plane
    // texture handle is forgotten.
    media::reset();
    match ran {
        Ok(next) => next,
        Err(error) => guest_fail(index, &error),
    }
}

/// A guest that cannot boot returns to the launcher instead of bricking the
/// device; app 0 itself, or a table of one, halts with the error on screen.
unsafe fn guest_fail(index: usize, message: &str) -> usize {
    if switch::multi() && index != 0 {
        frame::trace(&alloc::format!("guest error: {message}"));
        0
    } else {
        frame::halt(message)
    }
}
