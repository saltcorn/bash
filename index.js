const util = require("util");
const exec = util.promisify(require("child_process").exec);
const Table = require("@saltcorn/data/models/table");
const os = require("os");
const fs = require("fs").promises;

const { file } = require("tmp-promise");

module.exports = {
  sc_plugin_api_version: 1,
  actions: {
    run_bash_script: {
      configFields: async ({ table }) => {
        const commonFields = [
          {
            name: "cwd",
            label: "Working directory",
            type: "String",
          },
        ];
        if (table) {
          const fields = table.getFields();
          const str_field_opts = fields
            .filter((f) => f.type && f.type.name === "String")
            .map((f) => f.name);
          const exitcode_field_opts = fields
            .filter((f) => f.type && f.type.name === "Integer")
            .map((f) => f.name);

          return [
            {
              name: "script_source",
              label: "Script source",
              input_type: "select",
              required: true,
              options: ["Fixed", "Field"], //"Meta"
            },
            {
              name: "code",
              label: "Script",
              input_type: "code",
              attributes: { mode: "text/x-sh" },
              sublabel:
                "Row is <code>ROW_VARNAME</code>. If row is <code>{age:35}</code> then <code>ROW_AGE=35</code>. Use shebang for shell other than bash.",
              showIf: { script_source: "Fixed" },
            },
            {
              name: "code_field",
              label: "Script field",
              input_type: "select",
              options: str_field_opts,
              showIf: { script_source: "Field" },
            },
            /*{
              name: "jscode",
              label: "Script-generating code",
              sublabel: `JavaScript code that returns a script. Example: <code>return \`ls \${dir}\`</code>`,
              input_type: "code",
              attributes: { mode: "application/javascript" },
              showIf: { script_source: "Meta" },
            },*/
            {
              name: "exitcode_field",
              label: "Exit code field",
              type: "String",
              attributes: { options: exitcode_field_opts },
            },
            {
              name: "stdout_field",
              label: "stdout field",
              type: "String",
              attributes: { options: str_field_opts },
            },
            {
              name: "stderr_field",
              label: "stderr field",
              type: "String",
              attributes: { options: str_field_opts },
            },
            ...commonFields,
          ];
        } else
          return [
            {
              name: "code",
              label: "Code",
              sublabel:
                "Row is <code>ROW_VARNAME</code> variable names. If row is <code>{age:35}</code> then <code>ROW_AGE=35</code>. Use shebang for shell other than bash.",
              input_type: "code",
              attributes: { mode: "text/x-sh" },
            },
            ...commonFields,
          ];
      },
      run: async ({
        row,
        referrer,
        req,
        table,
        user,
        configuration: {
          script_source,
          code,
          jscode,
          code_field,
          exitcode_field,
          stdout_field,
          stderr_field,
          cwd,
        },
      }) => {
        let code_to_run = "";

        switch (script_source) {
          case "Fixed":
            code_to_run = code;
            break;
          case "Field":
            code_to_run = row[code_field];
            break;
          default:
            code_to_run = code;

            break;
        }
        code_to_run = code_to_run.replace(/\r\n/g, "\n");
        const rowEnv = {};
        Object.entries(row || {}).forEach(([k, v]) => {
          if (v?.toString && v.toString())
            rowEnv[`ROW_${k.toUpperCase()}`] = v.toString();
        });
        const u = user || req?.user;
        if (u) {
          rowEnv[`SC_USER_ID`] = u.id;
          rowEnv[`SC_USER_ROLE`] = u.role_id;
        }
        const { fd, path, cleanup } = await file();
        await fs.writeFile(path, code_to_run);
        let cmd = "bash";
        if (code_to_run.slice(0, 2) == "#!") {
          cmd = code_to_run.split("\n")[0].slice(2);
        }
        const eres = await exec(`${cmd} ${path}`, {
          cwd: cwd || os.homedir(),
          env: {
            ...process.env,
            ...rowEnv,
          },
        });
        await cleanup();
        if (table && row && (exitcode_field || stdout_field || stderr_field)) {
          const upd = {};
          if (exitcode_field) upd[exitcode_field] = eres.code || 0;
          if (stdout_field) upd[stdout_field] = eres.stdout || "";
          if (stderr_field) upd[stderr_field] = eres.stderr || "";
          await table.updateRow(upd, row.id);
        }
      },
    },
  },
};
