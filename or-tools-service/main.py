"""
ADSSU Scheduling — OR-Tools CP-SAT solver microservice.

Node.js precomputes the exact same candidate universe the greedy and genetic
engines use (buildSessions()/precomputeSessionCandidates() in
server/utils/scheduler.js) and sends it here as a flat list of sessions, each
with a list of candidate (room-or-online, day-pattern, valid-start-times)
options. This service's only job is the constraint solve: choose at most one
option per session such that no room, instructor, or section is ever
double-booked (enforced structurally via CP-SAT NoOverlap constraints, not a
penalty — a real solver guarantee the greedy/genetic engines cannot make),
while maximizing a precomputed per-option score.

The per-option score covers building-priority rank and mobility/accessibility
fit — the parts of scoreSlot() in scheduler.js that depend only on the
session and room. Day-clustering/adjacency/gap-penalty terms (which depend on
what OTHER sessions the same instructor ends up with) are intentionally not
modeled here — encoding them safely as a CP-SAT objective requires reified
product variables for every instructor-pair, a real scope-expanding addition
left for a future iteration. This is a documented simplification, not a bug.
"""

import time
from typing import Optional

from fastapi import FastAPI
from pydantic import BaseModel
from ortools.sat.python import cp_model

app = FastAPI(title="ADSSU OR-Tools Scheduling Service")

UNSCHEDULED_PENALTY = 5000  # heavily discourages leaving a session unscheduled


class Option(BaseModel):
    isOnline: bool = False
    roomId: Optional[int] = None
    days: list[str]
    durationMin: int
    baseScore: float = 0.0
    startOptions: list[int]


class Session(BaseModel):
    index: int
    instructorId: Optional[int] = None
    programYrSec: str = ""
    options: list[Option] = []


class SolveRequest(BaseModel):
    sessions: list[Session]
    maxTimeSeconds: float = 20.0


@app.get("/health")
def health():
    return {"status": "ok", "engine": "ortools-cp-sat"}


@app.post("/solve")
def solve(req: SolveRequest):
    model = cp_model.CpModel()
    wall_start = time.time()

    presence: dict[tuple[int, int], object] = {}
    starts: dict[tuple[int, int], object] = {}
    unscheduled: dict[int, object] = {}

    room_day_groups: dict[tuple[int, str], list] = {}
    instr_day_groups: dict[tuple[int, str], list] = {}
    sect_day_groups: dict[tuple[str, str], list] = {}

    for session in req.sessions:
        i = session.index
        presence_terms = []

        for k, opt in enumerate(session.options):
            if not opt.startOptions:
                continue
            domain = cp_model.Domain.FromValues(opt.startOptions)
            p = model.new_bool_var(f"p_{i}_{k}")
            s = model.new_int_var_from_domain(domain, f"s_{i}_{k}")
            iv = model.new_optional_fixed_size_interval_var(s, opt.durationMin, p, f"iv_{i}_{k}")

            presence[(i, k)] = p
            starts[(i, k)] = s
            presence_terms.append(p)

            if not opt.isOnline and opt.roomId is not None:
                for day in opt.days:
                    room_day_groups.setdefault((opt.roomId, day), []).append(iv)

            if session.instructorId is not None:
                for day in opt.days:
                    instr_day_groups.setdefault((session.instructorId, day), []).append(iv)

            if session.programYrSec:
                for day in opt.days:
                    sect_day_groups.setdefault((session.programYrSec, day), []).append(iv)

        u = model.new_bool_var(f"u_{i}")
        unscheduled[i] = u
        # Exactly one outcome per session: one of its options, or unscheduled.
        model.add(sum(presence_terms) + u == 1)

    # Hard constraints — a real solver guarantee, not a fitness penalty.
    for group in room_day_groups.values():
        model.add_no_overlap(group)
    for group in instr_day_groups.values():
        model.add_no_overlap(group)
    for group in sect_day_groups.values():
        model.add_no_overlap(group)

    objective_terms = []
    for session in req.sessions:
        i = session.index
        for k, opt in enumerate(session.options):
            if (i, k) not in presence:
                continue
            scaled = round(opt.baseScore)
            if scaled != 0:
                objective_terms.append(scaled * presence[(i, k)])
        objective_terms.append(-UNSCHEDULED_PENALTY * unscheduled[i])
    model.maximize(sum(objective_terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = req.maxTimeSeconds
    solver.parameters.num_search_workers = 8
    status = solver.solve(model)

    assignments = []
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        for session in req.sessions:
            i = session.index
            chosen = None
            if solver.value(unscheduled[i]) != 1:
                for k in range(len(session.options)):
                    if (i, k) in presence and solver.value(presence[(i, k)]) == 1:
                        chosen = k
                        break
            if chosen is None:
                assignments.append({"sessionIndex": i, "scheduled": False})
            else:
                assignments.append({
                    "sessionIndex": i,
                    "scheduled": True,
                    "optionIndex": chosen,
                    "startMin": solver.value(starts[(i, chosen)]),
                })

    return {
        "status": solver.status_name(status),
        "objectiveValue": solver.objective_value if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) else None,
        "wallTimeSeconds": round(time.time() - wall_start, 3),
        "assignments": assignments,
    }
