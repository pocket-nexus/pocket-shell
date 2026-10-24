// SPDX-License-Identifier: GPL-3.0-or-later
// @title Pocket
import Home from "./app.tsx";
import { mount } from "@pocketjs/framework/solid";
import { readScreen } from "../ui/screen.ts";

mount(() => {
  readScreen();
  return <Home />;
});
