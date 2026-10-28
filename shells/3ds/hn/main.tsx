// SPDX-License-Identifier: GPL-3.0-or-later
// @title Hacker News
import HackerNews from "./app.tsx";
import { mount } from "@pocketjs/framework/solid";
import { readScreen } from "../ui/screen.ts";

mount(() => {
  readScreen();
  return <HackerNews />;
});
