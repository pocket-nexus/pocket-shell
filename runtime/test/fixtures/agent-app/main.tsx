// SPDX-License-Identifier: GPL-3.0-or-later
// @title Agent Fixture
// The overlay registers when its module loads, before mount() runs.
import "../../../src/agent-layer.tsx";
import AgentFixture from "./app.tsx";
import { mount } from "@pocketjs/framework/solid";

mount(() => <AgentFixture />);
