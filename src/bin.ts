#!/usr/bin/env node

import { Command } from 'commander';
import { registerCommands } from './index';

const program = new Command();

program
  .name('lobstr')
  .description('LOBSTR — CLI for the agent economy protocol')
  .version('0.1.0');

registerCommands(program);

program.parse(process.argv);
