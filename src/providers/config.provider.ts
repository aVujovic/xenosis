import { getEnvironmentData, workerData } from 'node:worker_threads';
import { readFileSync } from 'fs';

export const getConfig = (path: any, required = true) => {
  try {
    const configContent = readFileSync(path, 'utf-8');
    try {
      return JSON.parse(configContent);
    } catch (error) {
      throw new Error(`Can not parse config: ${error}`);
    }
  } catch (err) {
    if (required) {
      throw err;
    }
    return {};
  }
};

const getCommandLineArg = (argName: string, required = true) => {
  const cmdLine = process.argv;
  const argIndex = cmdLine.indexOf(argName);

  if (argIndex === -1) {
    if (required) {
      throw new Error(`Missing command line argument ${argName}`);
    }
    return undefined;
  }

  const argValue = cmdLine[argIndex + 1];

  if (!argValue) {
    if (required) {
      throw new Error(`Missing value for command line argument ${argName}`);
    }
    return null;
  }

  return argValue;
};

const configProvider = () => {
  let config = workerData?.config;

  if (!config) {
    const configPath =
      getEnvironmentData('CONFIG_PATH') || getCommandLineArg('--config', false);

    if (!configPath) {
      throw new Error('Config not present');
    }

    const commonConfigPath =
      getEnvironmentData('COMMON_CONFIG_PATH') ||
      getCommandLineArg('--common-config', false);

    const configFile = getConfig(configPath);
    const commonConfigFile = getConfig(commonConfigPath, false);

    config = { ...commonConfigFile, ...configFile };
  }

  return config;
};

export default configProvider;
