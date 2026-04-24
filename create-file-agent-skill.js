const {
  div,
  pre,
  a,
  code,
  p,
  details,
  summary,
} = require("@saltcorn/markup/tags");
const { escapeHtml } = require("@saltcorn/data/utils");
const { spawn } = require("child_process");
const fs = require("fs").promises;
const path = require("path");
const os = require("os");

class CreateFileSkill {
  static skill_name = "Create file";

  get skill_label() {
    return "Create file";
  }

  constructor(cfg) {
    Object.assign(this, cfg);
  }

  async systemPrompt({ triggering_row, user }) {
    return `If you would like to create a file on the local or on a remote (via SSH) filesystemrun a shell command, use the create_file tool. 
Passwordless SSH access may be enabled on hosts the user specifies. in the create_file tool, specify the absolute path the file, and a string 
with the file contents. Optionally also specify the SSH host to create the file on, the SSH user and the SSH port`;
  }

  static async configFields() {
    return [{ name: "show_file", label: "Show file", type: "Bool" }];
  }
  async create_file(filepath, contents, sshHost, sshUser, sshPort) {
    if (!filepath || typeof filepath !== "string") {
      return "Error: filepath must be a non-empty string";
    }
    if (typeof contents !== "string") {
      return Error("Error: contents must be a string");
    }
    try {
      // Local case
      if (!sshHost) {
        await fs.writeFile(filepath, contents);
        return `File ${filepath} created`;
      }
    } catch (e) {
      return `Error: ${e.message}`;
    }

    // Remote case: stream contents to `cat > filepath` over SSH.
    // This avoids shell-escaping issues with the file contents.
    const target = sshUser ? `${sshUser}@${sshHost}` : sshHost;

    const sshArgs = [];
    if (sshPort !== undefined && sshPort !== null && sshPort !== "") {
      sshArgs.push("-p", String(sshPort));
    }
    // Disable interactive prompts; rely on key-based auth.
    sshArgs.push("-o", "BatchMode=yes");
    sshArgs.push(target);

    // Single-quote the remote filepath and escape any embedded single quotes.
    const quotedPath = `'${filepath.replace(/'/g, `'\\''`)}'`;
    sshArgs.push(`cat > ${quotedPath}`);

    await new Promise((resolve, reject) => {
      const child = spawn("ssh", sshArgs, { stdio: ["pipe", "pipe", "pipe"] });

      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              `ssh exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`,
            ),
          );
        }
      });

      child.stdin.on("error", reject);
      child.stdin.end(contents);
    });

    return `File ${filepath} on ${sshHost} created`;
  }

  provideTools() {
    return {
      type: "function",
      process: async (row, { req }) => {
        const result = await this.create_file(
          row.filepath,
          row.contents,
          row.ssh_host,
          row.ssh_user,
          row.ssh_port,
        );
        return result;
      },
      renderToolResponse: this.show_file
        ? async (response, { req, tool_call }) => {
            if (tool_call?.input?.contents && !response.startsWith("Error:")) {
              return details(
                summary(escapeHtml(response)),
                pre(escapeHtml(tool_call.input.contents)),
              );
            } else return p(escapeHtml(response));
          }
        : undefined,
      function: {
        name: "create_file",
        description:
          "Create a file on the local or remote (via SSH) filesystem",
        parameters: {
          type: "object",
          required: ["filepath", "contents"],
          properties: {
            filepath: {
              description: "The absolute path to the file to edit",
              type: "string",
            },
            contents: {
              description: "The string with the file contents",
              type: "string",
            },
            ssh_host: {
              description:
                "the remote SSH host to create the file on. Only the machine name, not user. Create locally if not supplied",
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

module.exports = CreateFileSkill;
