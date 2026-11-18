import threading

from monorail_worker import protocol as P
from monorail_worker.lease import Lease, Liveness
from monorail_worker.storage import read_json


def test_two_workers_one_lease(storage, clock):
    a = Lease(storage, "host-a:1", clock)
    b = Lease(storage, "host-b:2", clock)
    assert a.try_acquire() and a.held
    assert not b.try_acquire() and not b.held
    assert read_json(storage, P.LEASE)["holder"] == "host-a:1"

    # A renews every 10 s: B never gets in.
    for _ in range(5):
        clock.advance(10_000)
        assert a.try_acquire()
        assert not b.try_acquire()

    # A stops renewing (crashed). After 30 s, B takes over, and A can't come back.
    clock.advance(31_000)
    assert not a.held
    assert b.try_acquire() and b.held
    assert not a.try_acquire()
    assert read_json(storage, P.LEASE)["holder"] == "host-b:2"


def test_release_hands_over(storage, clock):
    a = Lease(storage, "a", clock)
    b = Lease(storage, "b", clock)
    assert a.try_acquire()
    a.release()
    assert not a.held
    assert b.try_acquire()


def test_held_stops_before_expiry(storage, clock):
    a = Lease(storage, "a", clock)
    a.try_acquire()
    clock.advance(28_500)
    assert not a.held  # 2 s safety margin


def test_simultaneous_acquire_one_winner(storage, clock):
    leases = [Lease(storage, f"w{i}", clock) for i in range(8)]
    barrier = threading.Barrier(len(leases))
    won = []

    def go(lease: Lease) -> None:
        barrier.wait()
        if lease.try_acquire():
            won.append(lease.holder)

    ts = [threading.Thread(target=go, args=(l,)) for l in leases]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    assert len(won) == 1


def test_standby_only_heartbeats_when_leader_is_stale(storage, clock):
    a = Lease(storage, "a", clock)
    b = Lease(storage, "b", clock)
    info = lambda: {"seq": 7, "omUrl": "u", "omVersion": "2.0.8", "version": "0.1.0", "inboxBacklog": 0}  # noqa: E731
    la, lb = Liveness(storage, a, info, clock), Liveness(storage, b, info, clock)
    la.tick()
    lb.tick()
    hb = read_json(storage, P.HEARTBEAT)
    assert hb["worker"] == "a" and hb["role"] == "leader" and hb["seq"] == 7
    # A dies; B keeps quiet until the heartbeat is stale, then takes the lease and heartbeats as leader.
    clock.advance(31_000)
    lb.tick()
    hb = read_json(storage, P.HEARTBEAT)
    assert hb["worker"] == "b" and hb["role"] == "leader"
