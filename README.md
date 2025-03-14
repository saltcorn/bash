# bash
Run bash actions in Saltcorn

The `run_bash_script` action allows you to run shell code. It used to be 
restricted to bash scripts, but you can now use any shell interpreter 
(including Python).

### Setting the shell interpreter

If you want to use a different shell interpreter than `bash`, you can set 
the first line to a [shebang](https://en.wikipedia.org/wiki/Shebang_(Unix))

### Accessing the row

If the action is run against a specific row (e.g. as a button in List or 
Show views, or Insert/Update triggers), the fields are used to set environment
variables. These are named `ROW_{field name in upper case}`. For instance, if 
the row contains a field called `name` then the environment variable `ROW_NAME` 
will be set. To access this in a bash script you should proceeded by a dollar sign ($),
for instance:

`echo $ROW_NAME`

### Accessing the user

The environment variables `SC_USER_ID` and `SC_USER_ROLE` are set to the 
user ID and the user's role ID, respectively

### In workflows


To use this in workflows you use environment variables to access 
variables in the context. You cannot use interpolation in the code as this might 
conflict with your chosen shell interpreter.

After the action has completed, the following variables will be set in the context 

* `exitcode`: the exit code as a number 
* `stdout`: the process standard output 
* `stderr`: the process standard error