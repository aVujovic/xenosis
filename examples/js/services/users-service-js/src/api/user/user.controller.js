import { Handler, Request, Response, Router } from '@xenosisorg/xenosis-core';
import {
  createUserSchema,
  idParamSchema,
  listUsersQuerySchema,
} from './user.schema.js';

/**
 * @typedef {import('@xenosisorg/xenosis-core').IServer} IServer
 * @typedef {import('../../services/User.service.js').default} UserService
 */

/**
 * @param {{ server: IServer; userService: UserService }} deps
 */
export default function UserController({ server, userService }) {
  const router = Router();

  router.route('/').get(
    Handler(Request.Query(listUsersQuerySchema), async (query) => {
      const users = await userService.list(query);
      return Response.OK(users);
    }),
  );

  router.route('/').post(
    Handler(Request.Body(createUserSchema), async (body) => {
      const created = await userService.create(body);
      return Response.Created(created);
    }),
  );

  router.route('/:id').get(
    Handler(Request.Params(idParamSchema), async ({ id }) => {
      const user = await userService.findById(id);
      return user ? Response.OK(user) : Response.NotFound({ id });
    }),
  );

  server.use('/api/v1/users', router);
  return server;
}
