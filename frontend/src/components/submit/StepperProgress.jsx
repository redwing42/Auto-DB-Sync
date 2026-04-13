import React from 'react';
import { Check } from 'lucide-react';

export default function StepperProgress({ steps, currentStep }) {
    return (
        <div className="stepper-progress" id="stepper-progress">
            {steps.map((label, i) => {
                const stepNum = i + 1;
                const isCompleted = stepNum < currentStep;
                const isActive = stepNum === currentStep;
                return (
                    <div
                        key={i}
                        className={`stepper-step ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`}
                    >
                        <div className="stepper-circle">
                            {isCompleted ? <Check size={14} /> : stepNum}
                        </div>
                        <span className="stepper-label">{label}</span>
                        {i < steps.length - 1 && <div className="stepper-line" />}
                    </div>
                );
            })}
        </div>
    );
}
