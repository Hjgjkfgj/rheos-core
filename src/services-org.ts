// Organigramme : arbre hiérarchique construit à partir des affectations courantes
// (managerEmploymentId). Les collaborateurs sans manager (ex. Directeur / PDG /
// gérant) constituent les racines.
import { Repository } from "./repository.js";
import { assertCan } from "./auth.js";
import { Ctx, AppError } from "./types.js";

interface OrgNode { employmentId: string; name: string; position?: string; reports: OrgNode[] }

export class OrgService {
  constructor(private repo: Repository) {}

  async chart(ctx: Ctx, companyId: string) {
    assertCan(ctx, "employee360.read");
    const le = await this.repo.getLegalEntity(ctx.tenantId, companyId);
    if (!le) throw new AppError(404, "not_found", "Entité juridique introuvable");
    const today = new Date().toISOString().slice(0, 10);
    const emps = (await this.repo.listEmploymentsByCompany(ctx.tenantId, companyId)).filter((e) => e.status !== "ENDED");

    const nodes = new Map<string, OrgNode & { managerId?: string }>();
    for (const e of emps) {
      const assignments = await this.repo.listAssignmentsByEmployment(ctx.tenantId, e.id);
      const cur = assignments.find((a) => a.validFrom <= today && (!a.validTo || today <= a.validTo)) ?? assignments[assignments.length - 1];
      const person = await this.repo.getPerson(ctx.tenantId, e.personId);
      const position = cur?.positionId ? (await this.repo.getPosition(ctx.tenantId, cur.positionId))?.title : undefined;
      nodes.set(e.id, { employmentId: e.id, name: person ? `${person.firstName} ${person.lastName}` : e.id, position, managerId: cur?.managerEmploymentId, reports: [] });
    }

    const roots: OrgNode[] = [];
    for (const node of nodes.values()) {
      const mgr = node.managerId && nodes.get(node.managerId);
      if (mgr) mgr.reports.push(node);
      else roots.push(node);
    }
    // nettoie le champ interne managerId
    const strip = (n: any): OrgNode => ({ employmentId: n.employmentId, name: n.name, position: n.position, reports: n.reports.map(strip) });
    return { companyId, count: nodes.size, roots: roots.map(strip) };
  }
}
