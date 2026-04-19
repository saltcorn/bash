const { div, pre, a, code } = require("@saltcorn/markup/tags");
const { spawn } = require("child_process");
//const { fieldProperties } = require("./helpers");

class BashSkill {
  static skill_name = "Run Bash command";

  get skill_label() {
    return "Bash";
  }

  constructor(cfg) {
    Object.assign(this, cfg);
  }

  async systemPrompt({ triggering_row, user }) {
    return `If you would like to run a shell command, use the run_bash tool. 
The run_bash command can be used to run commands locally or on a remote server via SSH. 
Passwordless SSH access may be enabled on hosts the user specifies. in the run_bash tool,
you specify the command you would like to run, optionally with an SSH host to run it on.`;
  }

  static async configFields() {
    return [{ name: "show_cmd", label: "Show command", type: "Bool" }];
  }
  async run_script(command, ssh_host, ssh_user, ssh_port) {
    return new Promise((resolve, reject) => {
      let output = "";

      let proc;
      if (ssh_host) {
        const args = ["-o", "BatchMode=yes"];

        if (ssh_port) {
          args.push("-p", ssh_port.toString());
        }

        const target = ssh_user ? `${ssh_user}@${ssh_host}` : ssh_host;
        args.push(target, "bash -s");

        proc = spawn("ssh", args, {
          stdio: ["pipe", "pipe", "pipe"],
        });
        proc.stdin.write(command);
        proc.stdin.end();
      } else {
        proc = spawn("bash", ["-s"], {
          stdio: ["pipe", "pipe", "pipe"],
        });
        proc.stdin.write(command);
        proc.stdin.end();
      }

      proc.stdout.on("data", (data) => {
        output += data.toString();
      });

      proc.stderr.on("data", (data) => {
        output += data.toString();
      });

      proc.on("error", (err) => {
        reject(err);
      });

      proc.on("close", () => {
        resolve(output);
      });
    });
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

module.exports = BashSkill;
