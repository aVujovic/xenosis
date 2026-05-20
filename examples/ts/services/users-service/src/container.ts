import { createContainer } from 'awilix';

/**
 * @typedef {Object} ServiceContext
 * @property {import('./services/User.service').default} userService
 * @property {import('./repository/User.repository').default} userRepository
 */

/**
 * @typedef {import('@xenosisorg/xenosis-core').Context & ServiceContext} Context
 */

const container = createContainer();

export default container;
