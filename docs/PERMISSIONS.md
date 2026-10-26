# Role–permission matrix

The source of truth is `core/src/permissions.ts`. The server checks these permissions on every operation; navigation only reflects them.

| Capability | Employee | Reporting Manager | Management | Super Admin |
|---|:-:|:-:|:-:|:-:|
| Submit own daily & weekly reports (configurable: `reportingRoles`) | ✓ | ✓ | – | – |
| View own reports, feedback, projects, analytics | ✓ | ✓ | – | – |
| View assigned employees and their reports | – | ✓ (assigned only) | – | – |
| Review / approve / return reports | – | ✓ (assigned only) | – | – |
| Company-wide analytics, directory, search | – | – | ✓ read-only | ✓ |
| View any employee's reports | – | – | ✓ read-only | ✓ |
| Export | own reports | team | company | company |
| Create / edit / deactivate users, assign roles & managers | – | – | – | ✓ |
| Departments, projects, work calendar, settings | – | – | – | ✓ |
| Audited corrections of submitted reports | – | – | – | ✓ |
| Audit logs | – | – | – | ✓ |
| Request a new project (stays PROPOSED) | ✓ | ✓ | – | – |

## Scope rules

- **Employee:** only their own records. They can look up active colleagues by name or code to add as collaborators; this returns name, code, department and designation only.
- **Reporting Manager:** only employees whose *current* primary manager or secondary reviewer is them. They can never review their own reports. Their own reports go to their manager.
- **Management:** read-only. Every write operation returns `permission-denied` (tested).
- **Super Admin:**
  - cannot view passwords
  - cannot change their own role or status
  - cannot remove the last Super Admin
  - cannot demote or deactivate a manager who still has active reportees
- **Drafts** are visible only to their author.
