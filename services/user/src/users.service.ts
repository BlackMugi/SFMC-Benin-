import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { AuthUser, Role } from '@sfmc/common';
import { CreateUserDto, RegisterDto, UpdateUserDto } from './user.dto';
import { User } from './user.entity';

const BCRYPT_ROUNDS = 10;
// faux hash : comparaison à temps constant même si l'utilisateur n'existe pas
const DUMMY_HASH = bcrypt.hashSync('dummy-password', BCRYPT_ROUNDS);

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly log = new Logger(UsersService.name);

  constructor(@InjectRepository(User) private readonly repo: Repository<User>) {}

  async onModuleInit() {
    const email = process.env.ADMIN_EMAIL?.toLowerCase();
    const password = process.env.ADMIN_PASSWORD;
    if (!email || !password) return;
    if (await this.repo.exists({ where: { email } })) return;
    await this.create({ email, password, firstName: 'Admin', lastName: 'SFMC', role: Role.Admin });
    this.log.log(`Compte administrateur initial créé : ${email}`);
  }

  async create(dto: CreateUserDto): Promise<User> {
    const email = dto.email.toLowerCase();
    if (await this.repo.exists({ where: { email } })) throw new ConflictException('Email déjà utilisé');
    const user = this.repo.create({
      email,
      firstName: dto.firstName,
      lastName: dto.lastName,
      role: dto.role,
      passwordHash: await bcrypt.hash(dto.password, BCRYPT_ROUNDS),
    });
    return this.strip(await this.repo.save(user));
  }

  /** Inscription publique : le rôle est toujours client. */
  register(dto: RegisterDto) {
    return this.create({ ...dto, role: Role.Client });
  }

  findAll() {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: string, caller: AuthUser): Promise<User> {
    if (caller.role === Role.Client && caller.id !== id) throw new ForbiddenException();
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    return user;
  }

  async update(id: string, dto: UpdateUserDto, caller: AuthUser): Promise<User> {
    const isAdmin = caller.role === Role.Admin;
    if (!isAdmin && caller.id !== id) throw new ForbiddenException();
    if (!isAdmin && (dto.role !== undefined || dto.active !== undefined)) throw new ForbiddenException('Seul un administrateur peut modifier le rôle ou le statut');
    const user = await this.findOne(id, caller);
    const { password, ...rest } = dto;
    Object.assign(user, rest);
    if (password) user.passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    return this.strip(await this.repo.save(user));
  }

  async remove(id: string): Promise<void> {
    const res = await this.repo.delete(id);
    if (!res.affected) throw new NotFoundException('Utilisateur introuvable');
  }

  /** Appelé par auth-service (REST interne). */
  async verifyCredentials(email: string, password: string) {
    const user = await this.repo.createQueryBuilder('u').addSelect('u.passwordHash').where('u.email = :email', { email: email.toLowerCase() }).getOne();
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok || !user.active) throw new UnauthorizedException('Identifiants invalides');
    return { id: user.id, email: user.email, role: user.role };
  }

  async findActiveById(id: string) {
    const user = await this.repo.findOne({ where: { id } });
    if (!user || !user.active) throw new UnauthorizedException();
    return { id: user.id, email: user.email, role: user.role };
  }

  private strip(user: User): User {
    const { passwordHash: _omit, ...rest } = user as User & { passwordHash?: string };
    return rest as User;
  }
}
