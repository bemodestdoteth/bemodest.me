import { GenericRepository } from '../repository.js';
import { Chain, ChainSchema } from '@bemodest/types';


export class ChainRepository extends GenericRepository<Chain, typeof ChainSchema> {
    constructor() {
        super('chains', ChainSchema);
    }
}
