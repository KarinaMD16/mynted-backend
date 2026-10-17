import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { BadgeScope } from './entities/badge.entity';

// Valida el filtro opcional ?scope=user|community.
@Injectable()
export class ParseOptionalScopePipe implements PipeTransform<
  string | undefined,
  BadgeScope | undefined
> {
  transform(value: string | undefined): BadgeScope | undefined {
    if (value === undefined || value === '') return undefined;
    if (!(Object.values(BadgeScope) as string[]).includes(value)) {
      throw new BadRequestException('scope debe ser user o community');
    }
    return value as BadgeScope;
  }
}
