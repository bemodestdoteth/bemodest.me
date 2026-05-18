import { GenericRepository } from '../repository.js';
import { AlertRule, AlertRuleSchema } from '../schemas/alertRule.js';


export class AlertRuleRepository extends GenericRepository<AlertRule, typeof AlertRuleSchema> {
    constructor() {
        super('alertRules', AlertRuleSchema);
    }
}
