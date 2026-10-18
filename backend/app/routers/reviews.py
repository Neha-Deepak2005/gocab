from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Review, Ride, RideStatus, User
from ..schemas import ReviewIn, ReviewOut, ReviewSummary
from ..security import get_current_user

router = APIRouter(prefix="/api/reviews", tags=["ratings & reviews"])


def _recalc(db: Session, user_id: int) -> None:
    avg, cnt = db.execute(select(func.avg(Review.rating), func.count(Review.id)).where(Review.rated_id == user_id)).one()
    user = db.get(User, user_id)
    user.rating_avg = round(float(avg), 2) if avg else 5.0
    user.rating_count = cnt


@router.post("", response_model=ReviewOut, status_code=201)
def create_review(data: ReviewIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Rider rates driver or driver rates rider after a completed ride."""
    ride = db.get(Ride, data.ride_id)
    if not ride or user.id not in (ride.rider_id, ride.driver_id):
        raise HTTPException(404, "Ride not found")
    if ride.status != RideStatus.COMPLETED:
        raise HTTPException(409, "You can rate after the ride is completed")
    rated_id = ride.driver_id if user.id == ride.rider_id else ride.rider_id
    review = Review(ride_id=ride.id, rater_id=user.id, rated_id=rated_id, rating=data.rating,
                    comment=(data.comment or "").strip() or None)
    db.add(review)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "You already rated this ride")
    _recalc(db, rated_id)
    db.commit()
    out = ReviewOut.model_validate(review)
    out.rater_name = user.name
    return out


@router.get("/user/{user_id}", response_model=ReviewSummary)
def user_reviews(user_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """Aggregated rating (average, count, star distribution) + latest reviews."""
    if not db.get(User, user_id):
        raise HTTPException(404, "User not found")
    dist_rows = db.execute(select(Review.rating, func.count()).where(Review.rated_id == user_id)
                           .group_by(Review.rating)).all()
    distribution = {i: 0 for i in range(1, 6)}
    distribution.update({r: c for r, c in dist_rows})
    count = sum(distribution.values())
    avg = round(sum(k * v for k, v in distribution.items()) / count, 2) if count else 0
    reviews = []
    for r in db.scalars(select(Review).where(Review.rated_id == user_id).order_by(Review.created_at.desc()).limit(20)):
        o = ReviewOut.model_validate(r)
        o.rater_name = r.rater.name
        reviews.append(o)
    return ReviewSummary(user_id=user_id, average=avg, count=count, distribution=distribution, reviews=reviews)
