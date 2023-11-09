const util = require("util");
const exec = util.promisify(require("child_process").exec);

module.exports = {
  sc_plugin_api_version: 1,
  actions: {
    run_bash_script: {
      configFields: async ({ table }) => {
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
              showIf: { script_source: "Fixed" },
            },
            {
              name: "code_field",
              label: "Script field",
              input_type: "select",
              options: str_field_opts,
              showIf: { script_source: "Field" },
            },
            {
              name: "jscode",
              label: "Script-generating code",
              sublabel: `JavaScript code that returns a script. Example: <code>return \`ls \${dir}\`</code>`,
              input_type: "code",
              attributes: { mode: "application/javascript" },
              showIf: { script_source: "Meta" },
            },
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
          ];
        } else
          return [
            {
              name: "code",
              label: "Code",
              input_type: "code",
              attributes: { mode: "text/x-sh" },
            },
          ];
      },
      run: async ({
        row,
        referrer,
        req,
        table,
        configuration: {
          script_source,
          code,
          jscode,
          code_field,
          exitcode_field,
          stdout_field,
          stderr_field,
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
        console.log({
          script_source,
          code,
          jscode,
          code_field,
          exitcode_field,
          stdout_field,
          stderr_field,
          code_to_run,
        });
        const eres = await exec(code_to_run);
        if (row && (exitcode_field || stdout_field || stderr_field)) {
          const upd = {};
          if (exitcode_field) upd[exitcode_field] = eres.code || 0;
          if (stdout_field) upd[stdout_field] = eres.stdout || "";
          if (stderr_field) upd[stderr_field] = eres.stderr || "";
          console.log(upd);
          console.log(await table.updateRow(upd, row.id));
        }
      },
    },
  },
};
