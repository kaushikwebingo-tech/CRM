import { Controller, Post, Get, Body, Req, Res, UnauthorizedException } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { CurrentUser } from '../common/decorators';
import { Public } from './auth.guard';
import { z } from 'zod';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
  orgId: z.string().uuid().optional(),
});

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
  ) {}

  @Public()
  @Post('login')
  async login(@Body() body: any, @Res({ passthrough: true }) res: Response) {
    const { email, password, orgId } = loginSchema.parse(body);
    const user = await this.authService.findUserByEmail(email, orgId);
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException();
    }
    const isValid = await this.authService.validatePassword(user, password);
    if (!isValid) {
      throw new UnauthorizedException();
    }
    const sessionId = await this.sessionService.createSession(user.id, user.orgId);
    res.cookie('crm.sid', sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/',
      signed: true,
    });
    const profile = await this.authService.getUserById(user.id);
    return profile;
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const sessionId = req.signedCookies['crm.sid'];
    if (sessionId) {
      await this.sessionService.destroySession(sessionId);
    }
    res.clearCookie('crm.sid');
    return { success: true };
  }

  @Get('me')
  async me(@CurrentUser() user: any) {
    return user;
  }

  @Get('users')
  async listUsers(@CurrentUser() user: any) {
    return this.authService.listUsers(user.orgId);
  }
}
