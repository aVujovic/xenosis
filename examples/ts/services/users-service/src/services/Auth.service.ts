import jwt, { type SignOptions } from 'jsonwebtoken';
import type { ILogger } from '@xenosisorg/xenosis-core';
import type UserRepository from '../repository/User.repository';

interface AuthConfig {
  jwtSecret: string;
  jwtExpiresIn?: string | number;
}

interface RootConfig {
  auth?: AuthConfig;
}

/**
 * Demo-grade auth: looks the user up by email and issues a JWT. There is no
 * password check on purpose — this example exists to show middleware wiring
 * and DI of `currentUser`, not authentication best practices.
 *
 * For a real app: pair this with hashed passwords (argon2), short-lived
 * access tokens + refresh tokens, and rotation. See AUTH.md.
 */
export default class AuthService {
  private logger: ILogger;
  private userRepository: UserRepository;
  private auth: AuthConfig;

  constructor({
    logger,
    userRepository,
    config,
  }: {
    logger: ILogger;
    userRepository: UserRepository;
    config: RootConfig;
  }) {
    if (!config.auth?.jwtSecret) {
      throw new Error('auth.jwtSecret missing in xenosis.config.json');
    }
    this.logger = logger;
    this.userRepository = userRepository;
    this.auth = config.auth;
  }

  async loginByEmail(email: string): Promise<{ token: string; user: { id: string; email: string; name: string } }> {
    const user = await this.userRepository.findByEmail(email);
    if (!user) {
      throw new Error(`No user with email ${email}`);
    }

    const signOptions: SignOptions = {
      subject: user.id,
      expiresIn: (this.auth.jwtExpiresIn ?? '1h') as SignOptions['expiresIn'],
    };

    const token = jwt.sign(
      { email: user.email, name: user.name },
      this.auth.jwtSecret,
      signOptions,
    );

    this.logger.info({ userId: user.id }, 'issued token');
    return { token, user: { id: user.id, email: user.email, name: user.name } };
  }
}
