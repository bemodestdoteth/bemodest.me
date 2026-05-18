import { GenericRepository } from '../repository.js';
import { Chain, ChainSchema } from '../schemas/chain.js';


export class ChainRepository extends GenericRepository<Chain, typeof ChainSchema> {
    constructor() {
        super('chains', ChainSchema);
    }
}
