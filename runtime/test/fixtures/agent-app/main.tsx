// SPDX-License-Identifier: GPL-3.0-or-later
// @title Agent Fixture
// The app contract declares "system.agent", so the build imports the agent's
// overlay ahead of this entry (runtime/manifest/system-layers.ts) and the
// overlay registers before mount() runs.
import AgentFixture from "./app.tsx";
import { mount } from "@pocketjs/framework/solid";

mount(() => <AgentFixture />);
