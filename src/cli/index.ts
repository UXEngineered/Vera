#!/usr/bin/env bun
import { Command } from "commander";
import { registerInitCommand } from "./init.ts";
import { registerAddCommand } from "./add.ts";
import { registerStatusCommand } from "./status.ts";
import { registerMonitorCommand } from "./monitor.ts";
import { registerGenerateCommand } from "./generate.ts";
import { registerWatchCommand } from "./watch.ts";
import { registerImportCommand } from "./import.ts";
import { registerApproveCommand } from "./approve.ts";
import { registerValidateCommand } from "./validate.ts";

const program = new Command();

program
  .name("vera")
  .description("VERA — Validated Evidence Ready Artifacts")
  .version("0.1.0");

registerInitCommand(program);
registerAddCommand(program);
registerStatusCommand(program);
registerMonitorCommand(program);
registerGenerateCommand(program);
registerWatchCommand(program);
registerImportCommand(program);
registerApproveCommand(program);
registerValidateCommand(program);

program.parse();
