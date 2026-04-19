const { div, pre, a, code } = require("@saltcorn/markup/tags");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
//const { fieldProperties } = require("./helpers");

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Count non-overlapping occurrences of `sub` in `str`.
 */
function countOccurrences(str, sub) {
  let count = 0;
  let pos = 0;
  while ((pos = str.indexOf(sub, pos)) !== -1) {
    count++;
    pos += sub.length;
  }
  return count;
}

/**
 * Produce a unified-diff string (like `diff -u`) purely in JS,
 * so we don't depend on external `diff` being installed.
 */
function generatePatch(filepath, oldText, newText) {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  // Use a simple LCS-based diff to produce unified hunks.
  const hunks = computeUnifiedHunks(oldLines, newLines, 3 /* context lines */);

  if (hunks.length === 0) {
    return "(no differences)";
  }

  const header = [`--- a/${filepath}`, `+++ b/${filepath}`];

  return header.concat(hunks.map(formatHunk)).join("\n") + "\n";
}

/**
 * Minimal Myers-like diff producing edit script, then grouped into
 * unified-diff hunks with `ctx` context lines.
 */
function computeUnifiedHunks(oldLines, newLines, ctx) {
  // Build edit script: array of { type: '='|'-'|'+', line }
  const edits = myersDiff(oldLines, newLines);

  // Identify change regions (runs of non-equal edits) and group with context.
  const changes = []; // { startIdx, endIdx } in edits[]
  let i = 0;
  while (i < edits.length) {
    if (edits[i].type !== "=") {
      const start = i;
      while (i < edits.length && edits[i].type !== "=") i++;
      changes.push({ start, end: i });
    } else {
      i++;
    }
  }

  if (changes.length === 0) return [];

  // Merge nearby changes into hunks when their context overlaps.
  const groups = [{ start: changes[0].start, end: changes[0].end }];
  for (let c = 1; c < changes.length; c++) {
    const gap = changes[c].start - groups[groups.length - 1].end;
    if (gap <= ctx * 2) {
      groups[groups.length - 1].end = changes[c].end;
    } else {
      groups.push({ start: changes[c].start, end: changes[c].end });
    }
  }

  // Build hunks with context lines.
  return groups.map((g) => {
    const hunkStart = Math.max(0, g.start - ctx);
    const hunkEnd = Math.min(edits.length, g.end + ctx);
    return edits.slice(hunkStart, hunkEnd);
  });
}

function formatHunk(editSlice) {
  let oldStart = 1,
    newStart = 1;

  // We need to figure out the line numbers. Walk all edits from the
  // beginning would be expensive; instead we store line counters in the
  // edit objects during myersDiff.  If they aren't there, we fall back to
  // a simpler scheme: we count within the slice.

  // Count lines for the header
  let oldCount = 0,
    newCount = 0;
  const lines = editSlice.map((e) => {
    if (e.type === "=") {
      oldCount++;
      newCount++;
      return " " + e.line;
    }
    if (e.type === "-") {
      oldCount++;
      return "-" + e.line;
    }
    /* '+' */ {
      newCount++;
      return "+" + e.line;
    }
  });

  // Use stored positions if available
  for (const e of editSlice) {
    if (e.type === "=" || e.type === "-") {
      oldStart = e.oldLineNo;
      break;
    }
  }
  for (const e of editSlice) {
    if (e.type === "=" || e.type === "+") {
      newStart = e.newLineNo;
      break;
    }
  }

  const header = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;
  return [header, ...lines].join("\n");
}

/**
 * Simple O(ND) Myers diff returning an edit script with line numbers.
 */
function myersDiff(oldLines, newLines) {
  const N = oldLines.length;
  const M = newLines.length;
  const MAX = N + M;

  // For very large files, fall back to a simple approach to avoid
  // excessive memory / time.
  if (MAX > 50000) {
    return simpleDiff(oldLines, newLines);
  }

  const V = new Map();
  V.set(1, 0);
  const trace = [];

  outer: for (let d = 0; d <= MAX; d++) {
    const vSnap = new Map(V);
    trace.push(vSnap);
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && (V.get(k - 1) || 0) < (V.get(k + 1) || 0))) {
        x = V.get(k + 1) || 0;
      } else {
        x = (V.get(k - 1) || 0) + 1;
      }
      let y = x - k;
      while (x < N && y < M && oldLines[x] === newLines[y]) {
        x++;
        y++;
      }
      V.set(k, x);
      if (x >= N && y >= M) break outer;
    }
  }

  // Backtrack to recover the edit script.
  let x = N,
    y = M;
  const edits = [];

  for (let d = trace.length - 1; d > 0; d--) {
    const vPrev = trace[d - 1];
    const k = x - y;
    let prevK;
    if (
      k === -d ||
      (k !== d && (vPrev.get(k - 1) || 0) < (vPrev.get(k + 1) || 0))
    ) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    let prevX = vPrev.get(prevK) || 0;
    let prevY = prevX - prevK;

    // Diagonal (equal lines)
    while (x > prevX && y > prevY) {
      x--;
      y--;
      edits.push({
        type: "=",
        line: oldLines[x],
        oldLineNo: x + 1,
        newLineNo: y + 1,
      });
    }

    if (d > 0) {
      if (x === prevX) {
        // Insertion
        y--;
        edits.push({
          type: "+",
          line: newLines[y],
          oldLineNo: x + 1,
          newLineNo: y + 1,
        });
      } else {
        // Deletion
        x--;
        edits.push({
          type: "-",
          line: oldLines[x],
          oldLineNo: x + 1,
          newLineNo: y + 1,
        });
      }
    }
  }
  // Handle remaining diagonal at d=0
  while (x > 0 && y > 0) {
    x--;
    y--;
    edits.push({
      type: "=",
      line: oldLines[x],
      oldLineNo: x + 1,
      newLineNo: y + 1,
    });
  }

  edits.reverse();
  return edits;
}

/**
 * Fallback simple diff for very large files: find the changed region
 * by scanning from both ends, then emit = / - / + blocks.
 */
function simpleDiff(oldLines, newLines) {
  let top = 0;
  while (
    top < oldLines.length &&
    top < newLines.length &&
    oldLines[top] === newLines[top]
  )
    top++;
  let botOld = oldLines.length - 1;
  let botNew = newLines.length - 1;
  while (
    botOld >= top &&
    botNew >= top &&
    oldLines[botOld] === newLines[botNew]
  ) {
    botOld--;
    botNew--;
  }

  const edits = [];
  for (let i = 0; i < top; i++) {
    edits.push({
      type: "=",
      line: oldLines[i],
      oldLineNo: i + 1,
      newLineNo: i + 1,
    });
  }
  for (let i = top; i <= botOld; i++) {
    edits.push({
      type: "-",
      line: oldLines[i],
      oldLineNo: i + 1,
      newLineNo: top + 1,
    });
  }
  for (let i = top; i <= botNew; i++) {
    edits.push({
      type: "+",
      line: newLines[i],
      oldLineNo: botOld + 2,
      newLineNo: i + 1,
    });
  }
  const offset = botNew - botOld;
  for (let i = botOld + 1; i < oldLines.length; i++) {
    edits.push({
      type: "=",
      line: oldLines[i],
      oldLineNo: i + 1,
      newLineNo: i + 1 + offset,
    });
  }
  return edits;
}

/**
 * Minimal POSIX-style shell quoting.
 */
function shellQuote(s) {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

class EditFileSkill {
  static skill_name = "Edit file";

  get skill_label() {
    return "Edit file";
  }

  constructor(cfg) {
    Object.assign(this, cfg);
  }

  async systemPrompt({ triggering_row, user }) {
    return `If you would like to edit a file on the local or on a remote (via SSH) filesystemrun a shell command, use the edit_file tool. 
Passwordless SSH access may be enabled on hosts the user specifies. in the edit_file too, specify the absolute path the file, a string in 
the file that must match uniquely, and the new string to replace this with. Optionally also specify the SSH host to edit the file on.`;
  }

  static async configFields() {
    return [{ name: "show_edit", label: "Show edit", type: "Bool" }];
  }
  async edit_file(filepath, old_str, new_str, sshHost, sshUser, sshPort) {
    try {
      // ── Build SSH prefix ─────────────────────────────────────────
      const sshPrefix = sshHost
        ? [
            "ssh",
            ...(sshPort ? ["-p", sshPort] : []),
            ...(sshUser ? [`${sshUser}@${sshHost}`] : [sshHost]),
          ].join(" ")
        : null;
      // ── Read the original file ──────────────────────────────────
      let originalContent;
      if (sshHost) {
        try {
          originalContent = execSync(
            `ssh ${sshPrefix} cat ${shellQuote(filepath)}`,
            { encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 },
          );
        } catch (err) {
          return `Error: Could not read remote file "${filepath}" on ${sshHost}.\n${err.stderr || err.message}`;
        }
      } else {
        if (!fs.existsSync(filepath)) {
          return `Error: File "${filepath}" does not exist.`;
        }
        try {
          originalContent = fs.readFileSync(filepath, "utf-8");
        } catch (err) {
          return `Error: Could not read file "${filepath}".\n${err.message}`;
        }
      }

      // ── Validate old_str ────────────────────────────────────────
      if (old_str === "") {
        return "Error: old_str must not be empty.";
      }

      const occurrences = countOccurrences(originalContent, old_str);

      if (occurrences === 0) {
        return `Error: old_str was not found in "${filepath}".`;
      }
      if (occurrences > 1) {
        return `Error: old_str appears ${occurrences} times in "${filepath}". It must be unique (exactly 1 match).`;
      }

      // ── Apply the replacement ───────────────────────────────────
      const newContent = originalContent.replace(old_str, new_str);

      // ── Generate the unified diff BEFORE writing ────────────────
      const patch = generatePatch(filepath, originalContent, newContent);

      // ── Write the modified file ─────────────────────────────────
      if (sshHost) {
        // Write via SSH: pipe new content through stdin
        try {
          execSync(`ssh ${sshPrefix} tee ${shellQuote(filepath)} > /dev/null`, {
            input: newContent,
            encoding: "utf-8",
            maxBuffer: 50 * 1024 * 1024,
          });
        } catch (err) {
          return `Error: Could not write remote file "${filepath}" on ${sshHost}.\n${err.stderr || err.message}`;
        }
      } else {
        try {
          fs.writeFileSync(filepath, newContent, "utf-8");
        } catch (err) {
          return `Error: Could not write file "${filepath}".\n${err.message}`;
        }
      }

      return patch;
    } catch (err) {
      return `Error: Unexpected failure.\n${err.message}`;
    }
  }

  provideTools() {
    return {
      type: "function",
      process: async (row, { req }) => {
        return await this.run_script(
          row.command,
          row.ssh_host,
          row.ssh_user,
          row.ssh_port,
        );
      },
      renderToolCall: ({ command }, { req }) => {
        if (this.show_cmd) return pre(code(command));
      },
      renderToolResponse: this.display_result
        ? async (response, { req }) => {
            return div({ class: "border border-success p-2 m-2" }, response);
          }
        : undefined,
      function: {
        name: "run_bash",
        description: "Run a bash command, returning the stdout and stderr",
        parameters: {
          type: "object",
          required: ["command"],
          properties: {
            command: {
              description: "The bash command to run",
              type: "string",
            },
            ssh_host: {
              description:
                "the remote SSH host to run this on. Only the machine name, not user. Run local if not supplied",
              type: "string",
            },
            ssh_user: {
              description: "The user on the remote SSH machine to run as.",
              type: "string",
            },
            ssh_port: {
              description: "The SSH port if different from the default 22",
              type: "number",
            },
          },
        },
      },
    };
  }
}

module.exports = EditFileSkill;
