import pc from 'picocolors';

export const log = {
  info(msg: string) {
    console.log(pc.dim('●'), msg);
  },
  ok(msg: string) {
    console.log(pc.green('✓'), msg);
  },
  warn(msg: string) {
    console.log(pc.yellow('!'), msg);
  },
  err(msg: string) {
    console.error(pc.red('✗'), msg);
  },
  step(msg: string) {
    console.log(pc.cyan('→'), pc.bold(msg));
  },
  hint(msg: string) {
    console.log(pc.dim(`  ${msg}`));
  },
  blank() {
    console.log();
  },
};
