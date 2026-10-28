import { getMetadataArgsStorage } from 'typeorm';
import { Report } from './report.entity';
import { ReportItemType } from '../enums/report-item-type.enum';
import { ReportReason } from '../enums/report-reason.enum';
import { ReportStatus } from '../enums/report-status.enum';

describe('Report entity metadata', () => {
  const storage = getMetadataArgsStorage();

  it('maps the report table, enums, timestamps and duplicate constraint', () => {
    const entity = storage.tables.find((table) => table.target === Report);
    const unique = storage.uniques.find(
      (constraint) => constraint.target === Report,
    );
    const columns = storage.columns.filter(
      (column) => column.target === Report,
    );

    expect(entity?.name).toBe('report');
    expect(unique?.name).toBe('UQ_report_reporter_id_item_type_item_id');
    expect(unique?.columns).toEqual(['reporterId', 'itemType', 'itemId']);
    expect(
      columns.find((column) => column.propertyName === 'reporterId')?.options,
    ).toEqual(expect.objectContaining({ name: 'reporter_id', type: 'uuid' }));
    expect(
      columns.find((column) => column.propertyName === 'communityId')?.options,
    ).toEqual(
      expect.objectContaining({ name: 'community_id', nullable: true }),
    );
    expect(
      columns.find((column) => column.propertyName === 'resolvedByUserId')
        ?.options,
    ).toEqual(
      expect.objectContaining({
        name: 'resolved_by_user_id',
        type: 'uuid',
        nullable: true,
      }),
    );
    expect(
      columns.find((column) => column.propertyName === 'status')?.options,
    ).toEqual(expect.objectContaining({ default: ReportStatus.PENDING }));
    expect(Object.values(ReportItemType)).toEqual([
      'post',
      'reply',
      'product',
      'conversation',
      'community',
    ]);
    expect(Object.values(ReportReason)).toEqual([
      'spam',
      'fake_product',
      'offensive_language',
      'harassment',
      'inappropriate_content',
      'other',
    ]);
  });
});
