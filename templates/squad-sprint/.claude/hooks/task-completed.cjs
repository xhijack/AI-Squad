#!/usr/bin/env node
// Squad Sprint quality gate when a task is about to be completed (TaskCompleted hook).
// Exit 2 = refuse (the task stays open, stderr goes to the agent). Exit 0 = pass.
// Task names (words 1 and 2 are read):  BUILD M01 Login  |  QA M01 Login  |  BUG M01-B01 Save does nothing
const fs = require('fs');
const path = require('path');
const { config, readInput, squadDir, strings, reject, checkTask, taskOf } = require('./squad-lib.cjs');

const input = readInput();
const cfg = config();
const dir = squadDir(cfg);
if (cfg.HOOK_DEBUG === '1') fs.writeFileSync(path.join(dir, '.hook-log', 'task-completed-last.json'), JSON.stringify(input, null, 2));

// field names are not fully documented: try a few, then the first string that starts with BUILD/QA/BUG
const TASK = /^\s*\[?(BUILD|QA|BUG)\]?\s+M\d/i;
const subject = [input.task_subject, input.task && input.task.subject, input.subject, input.task_title, input.task && input.task.title].find((s) => typeof s === 'string' && s)
  || strings(input).find((s) => TASK.test(s)) || '';
const task = taskOf(subject);
if (!task) process.exit(0);
const why = checkTask(task.kind, task.id, cfg, dir);
if (why) reject(why);
process.exit(0);
