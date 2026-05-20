import PrismaConnection from '../libs/prismaConnection';

const prismaProvider = ({ logger, config }: { logger: any; config: any }) => {
  const prisma = new PrismaConnection({ logger, config });
  return prisma.prismaClient;
};

export default prismaProvider;
