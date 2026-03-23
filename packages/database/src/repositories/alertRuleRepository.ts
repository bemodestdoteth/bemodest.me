import { GenericRepository } from '../repository.js';
import { AlertRule, AlertRuleSchema } from '@bemodest/types';


export class AlertRuleRepository extends GenericRepository<AlertRule, typeof AlertRuleSchema> {
    constructor() {
        super('alertRules', AlertRuleSchema);
    }
}
